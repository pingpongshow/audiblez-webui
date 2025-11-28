#!/usr/bin/env python3
"""
Audiblez Web GUI - Flask Backend
Provides web interface for converting ebooks to audiobooks
"""

from flask import Flask, render_template, request, jsonify, send_file
from werkzeug.utils import secure_filename
import os
import subprocess
import json
import threading
import re
from pathlib import Path
from datetime import datetime
import time

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB max file size
app.config['UPLOAD_FOLDER'] = '/tmp/uploads'
app.config['EBOOK_FOLDER'] = '/ebooks'
app.config['AUDIOBOOK_FOLDER'] = '/audiobooks'
app.config['AUTO_CLEANUP'] = os.environ.get('AUTO_CLEANUP', 'true').lower() == 'true'

# Ensure upload folder exists
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Global conversion status storage
conversion_status = {}
conversion_lock = threading.Lock()

# Voice options by language
VOICES = {
    "American English": [
        "af_alloy", "af_aoede", "af_bella", "af_heart", "af_jessica", 
        "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", 
        "af_sky", "am_adam", "am_echo", "am_eric", "am_fenrir", 
        "am_liam", "am_michael", "am_onyx", "am_puck", "am_santa"
    ],
    "British English": [
        "bf_alice", "bf_emma", "bf_isabella", "bf_lily", 
        "bm_daniel", "bm_fable", "bm_george", "bm_lewis"
    ],
    "Spanish": ["ef_dora", "em_alex", "em_santa"],
    "French": ["ff_siwis"],
    "Hindi": ["hf_alpha", "hf_beta", "hm_omega", "hm_psi"],
    "Italian": ["if_sara", "im_nicola"],
    "Japanese": ["jf_alpha", "jf_gongitsune", "jf_nezumi", "jf_tebukuro", "jm_kumo"],
    "Brazilian Portuguese": ["pf_dora", "pm_alex", "pm_santa"],
    "Mandarin Chinese": [
        "zf_xiaobei", "zf_xiaoni", "zf_xiaoxiao", "zf_xiaoyi", 
        "zm_yunjian", "zm_yunxi", "zm_yunxia", "zm_yunyang"
    ]
}


def get_ebook_files():
    """Get list of epub files from the ebook folder"""
    try:
        ebook_path = Path(app.config['EBOOK_FOLDER'])
        if not ebook_path.exists():
            return []
        
        files = []
        for file in ebook_path.rglob('*.epub'):
            rel_path = file.relative_to(ebook_path)
            files.append({
                'name': file.name,
                'path': str(file),
                'relative_path': str(rel_path),
                'size': file.stat().st_size,
                'modified': datetime.fromtimestamp(file.stat().st_mtime).isoformat()
            })
        
        return sorted(files, key=lambda x: x['name'])
    except Exception as e:
        print(f"Error getting ebook files: {e}")
        return []


def parse_progress_output(line):
    """Parse progress and time remaining from audiblez output"""
    progress_match = re.search(r'Progress:\s*(\d+)%', line)
    time_match = re.search(r'Estimated time remaining:\s*(\d+)d\s*(\d+)h\s*(\d+)m\s*(\d+)s', line)
    
    result = {}
    if progress_match:
        result['progress'] = int(progress_match.group(1))
    
    if time_match:
        days = int(time_match.group(1))
        hours = int(time_match.group(2))
        minutes = int(time_match.group(3))
        seconds = int(time_match.group(4))
        result['time_remaining'] = f"{days}d {hours}h {minutes}m {seconds}s"
        result['time_remaining_seconds'] = days * 86400 + hours * 3600 + minutes * 60 + seconds
    
    return result


def cleanup_temporary_files(output_folder, epub_name):
    """
    Clean up temporary files created during conversion.
    Keeps only .m4b files and removes .wav, .txt, cover files, and other temporary files.
    """
    try:
        output_path = Path(output_folder)
        if not output_path.exists():
            return 0
        
        # Get the base name of the epub file (without extension)
        base_name = Path(epub_name).stem
        
        deleted_count = 0
        deleted_size = 0
        
        # Find all files in the output directory related to this conversion
        for file in output_path.iterdir():
            if file.is_file():
                # Check if file is related to this conversion
                # and is NOT an m4b file
                # Also remove cover files and chapters.txt
                should_delete = False
                
                if file.stem.startswith(base_name) and file.suffix != '.m4b':
                    should_delete = True
                elif file.name == 'cover' or file.name.startswith('cover.'):
                    should_delete = True
                elif file.name == 'chapters.txt':
                    should_delete = True
                
                if should_delete:
                    file_size = file.stat().st_size
                    try:
                        file.unlink()
                        deleted_count += 1
                        deleted_size += file_size
                        print(f"Deleted temporary file: {file.name} ({file_size} bytes)")
                    except Exception as e:
                        print(f"Failed to delete {file.name}: {e}")
        
        if deleted_count > 0:
            print(f"Cleanup complete: Deleted {deleted_count} temporary files ({deleted_size / 1024 / 1024:.2f} MB)")
        
        return deleted_count
    
    except Exception as e:
        print(f"Error during cleanup: {e}")
        return 0


def set_file_permissions(file_path):
    """
    Set file permissions to 777 (rwxrwxrwx) and ownership to nobody:users.
    """
    try:
        import pwd
        import grp
        
        # Set permissions to 777
        os.chmod(file_path, 0o777)
        
        # Try to set ownership to nobody:users
        try:
            nobody_uid = pwd.getpwnam('nobody').pw_uid
            users_gid = grp.getgrnam('users').gr_gid
            os.chown(file_path, nobody_uid, users_gid)
            print(f"Set permissions for {Path(file_path).name}: rwxrwxrwx nobody:users")
        except (KeyError, PermissionError) as e:
            # If we can't set ownership (not running as root), just set permissions
            print(f"Set permissions for {Path(file_path).name}: rwxrwxrwx (ownership unchanged: {e})")
    
    except Exception as e:
        print(f"Failed to set permissions for {Path(file_path).name}: {e}")


def compress_m4b(job_id, m4b_path, bitrate='64k'):
    """
    Compress M4B file using ffmpeg, preserving cover art.
    Replaces original file with compressed version.
    Returns tuple: (success, original_size, compressed_size, error_message)
    """
    try:
        m4b_file = Path(m4b_path)
        if not m4b_file.exists():
            return False, 0, 0, "M4B file not found"
        
        original_size = m4b_file.stat().st_size
        
        # Create compressed file path
        compressed_path = m4b_file.parent / f"{m4b_file.stem}_compressed.m4b"
        
        print(f"Compressing {m4b_file.name} at {bitrate}...")
        
        # Update status to show compression started
        with conversion_lock:
            conversion_status[job_id]['compression_progress'] = 0
        
        # Run ffmpeg compression with cover art preservation
        # -map 0:a maps audio stream
        # -map 0:v? maps video stream (cover art) if it exists (? makes it optional)
        # -c:v copy copies the cover art without re-encoding
        process = subprocess.Popen(
            [
                'ffmpeg', '-i', str(m4b_file),
                '-map', '0:a',      # Map audio stream
                '-map', '0:v?',     # Map video/cover stream if exists (optional)
                '-c:a', 'aac',      # Audio codec
                '-b:a', bitrate,    # Audio bitrate
                '-c:v', 'copy',     # Copy cover art without re-encoding
                str(compressed_path),
                '-y'  # Overwrite output file if exists
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1
        )
        
        # Monitor ffmpeg output for progress
        duration = None
        for line in process.stdout:
            # Try to extract duration
            if duration is None and 'Duration:' in line:
                duration_match = re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', line)
                if duration_match:
                    hours = int(duration_match.group(1))
                    minutes = int(duration_match.group(2))
                    seconds = float(duration_match.group(3))
                    duration = hours * 3600 + minutes * 60 + seconds
            
            # Extract current time position
            if duration and 'time=' in line:
                time_match = re.search(r'time=(\d+):(\d+):(\d+\.\d+)', line)
                if time_match:
                    hours = int(time_match.group(1))
                    minutes = int(time_match.group(2))
                    seconds = float(time_match.group(3))
                    current_time = hours * 3600 + minutes * 60 + seconds
                    progress = min(int((current_time / duration) * 100), 99)
                    
                    with conversion_lock:
                        conversion_status[job_id]['compression_progress'] = progress
        
        return_code = process.wait()
        
        if return_code != 0:
            return False, original_size, 0, f"FFmpeg compression failed with code {return_code}"
        
        if not compressed_path.exists():
            return False, original_size, 0, "Compressed file was not created"
        
        compressed_size = compressed_path.stat().st_size
        
        # Replace original file with compressed version
        m4b_file.unlink()
        compressed_path.rename(m4b_file)
        
        # Set proper permissions on the final M4B file
        set_file_permissions(str(m4b_file))
        
        reduction = ((original_size - compressed_size) / original_size) * 100
        print(f"Compression complete: {original_size / 1024 / 1024:.1f}MB → {compressed_size / 1024 / 1024:.1f}MB ({reduction:.1f}% reduction)")
        
        return True, original_size, compressed_size, None
    
    except Exception as e:
        return False, 0, 0, str(e)


def run_conversion(job_id, epub_path, voice, speed, use_cuda, use_compress, output_folder):
    """Run the audiblez conversion in a separate thread"""
    
    # Build command
    cmd = ['audiblez', epub_path]
    
    if voice:
        cmd.extend(['-v', voice])
    
    if speed:
        cmd.extend(['-s', str(speed)])
    
    if use_cuda:
        cmd.append('-c')
    
    if output_folder:
        cmd.extend(['-o', output_folder])
    
    # Update status to running
    with conversion_lock:
        conversion_status[job_id]['status'] = 'running'
        conversion_status[job_id]['command'] = ' '.join(cmd)
        conversion_status[job_id]['start_time'] = datetime.now().isoformat()
    
    try:
        # Run the process
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1
        )
        
        # Store process ID
        with conversion_lock:
            conversion_status[job_id]['pid'] = process.pid
        
        # Read output line by line
        for line in process.stdout:
            line = line.strip()
            if line:
                # Parse progress information
                progress_info = parse_progress_output(line)
                
                with conversion_lock:
                    conversion_status[job_id]['last_output'] = line
                    if progress_info:
                        conversion_status[job_id].update(progress_info)
        
        # Wait for process to complete
        return_code = process.wait()
        
        # Update final status
        with conversion_lock:
            if return_code == 0:
                conversion_status[job_id]['status'] = 'completed'
                conversion_status[job_id]['progress'] = 100
                
                # Mark for compression if requested
                should_compress = use_compress
        
        # Compress M4B if requested (outside lock to avoid blocking)
        if return_code == 0 and should_compress:
            with conversion_lock:
                conversion_status[job_id]['status'] = 'compressing'
                conversion_status[job_id]['compression_progress'] = 0
            
            # Find the M4B file
            epub_name = Path(epub_path).stem
            m4b_file = Path(output_folder) / f"{epub_name}.m4b"
            
            if m4b_file.exists():
                success, original_size, compressed_size, error = compress_m4b(job_id, str(m4b_file))
                
                with conversion_lock:
                    if success:
                        conversion_status[job_id]['compressed'] = True
                        conversion_status[job_id]['original_size'] = original_size
                        conversion_status[job_id]['compressed_size'] = compressed_size
                        reduction = ((original_size - compressed_size) / original_size) * 100
                        conversion_status[job_id]['compression_reduction'] = round(reduction, 1)
                        conversion_status[job_id]['compression_progress'] = 100
                    else:
                        conversion_status[job_id]['compressed'] = False
                        conversion_status[job_id]['compression_error'] = error
            else:
                with conversion_lock:
                    conversion_status[job_id]['compressed'] = False
                    conversion_status[job_id]['compression_error'] = "M4B file not found"
        
        # If compression was NOT used, set permissions on the original M4B file
        if return_code == 0 and not should_compress:
            epub_name = Path(epub_path).stem
            m4b_file = Path(output_folder) / f"{epub_name}.m4b"
            if m4b_file.exists():
                set_file_permissions(str(m4b_file))
        
        # Clean up temporary files and finalize (if successful)
        with conversion_lock:
            if return_code == 0:
                conversion_status[job_id]['status'] = 'completed'
                
                # Auto cleanup
                if app.config['AUTO_CLEANUP']:
                    epub_name = Path(epub_path).name
                    deleted_count = cleanup_temporary_files(output_folder, epub_name)
                    conversion_status[job_id]['cleanup_files_deleted'] = deleted_count
                else:
                    conversion_status[job_id]['cleanup_files_deleted'] = 0
            else:
                conversion_status[job_id]['status'] = 'failed'
                conversion_status[job_id]['error'] = f"Process exited with code {return_code}"
            
            conversion_status[job_id]['end_time'] = datetime.now().isoformat()
    
    except Exception as e:
        with conversion_lock:
            conversion_status[job_id]['status'] = 'failed'
            conversion_status[job_id]['error'] = str(e)
            conversion_status[job_id]['end_time'] = datetime.now().isoformat()


@app.route('/')
def index():
    """Main page"""
    return render_template('index.html')


@app.route('/api/voices')
def get_voices():
    """Get available voices grouped by language"""
    return jsonify(VOICES)


@app.route('/api/ebooks')
def list_ebooks():
    """List available ebook files"""
    files = get_ebook_files()
    return jsonify(files)


@app.route('/api/upload', methods=['POST'])
def upload_file():
    """Upload an epub file"""
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    if not file.filename.endswith('.epub'):
        return jsonify({'error': 'Only .epub files are allowed'}), 400
    
    try:
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        return jsonify({
            'success': True,
            'filename': filename,
            'filepath': filepath
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/convert', methods=['POST'])
def convert_ebook():
    """Start conversion of an ebook to audiobook"""
    data = request.json
    
    # Get parameters
    epub_path = data.get('epub_path')
    voice = data.get('voice', 'af_sky')
    speed = data.get('speed', 1.0)
    use_cuda = data.get('use_cuda', False)
    use_compress = data.get('compress', True)
    output_folder = data.get('output_folder', app.config['AUDIOBOOK_FOLDER'])
    
    if not epub_path:
        return jsonify({'error': 'No epub file specified'}), 400
    
    if not os.path.exists(epub_path):
        return jsonify({'error': 'Epub file not found'}), 404
    
    # Generate job ID
    job_id = f"{Path(epub_path).stem}_{int(time.time())}"
    
    # Initialize job status
    with conversion_lock:
        conversion_status[job_id] = {
            'job_id': job_id,
            'epub_path': epub_path,
            'epub_name': Path(epub_path).name,
            'status': 'pending',
            'progress': 0,
            'voice': voice,
            'speed': speed,
            'use_cuda': use_cuda,
            'compress': use_compress,
            'output_folder': output_folder,
            'created_time': datetime.now().isoformat()
        }
    
    # Start conversion in background thread
    thread = threading.Thread(
        target=run_conversion,
        args=(job_id, epub_path, voice, speed, use_cuda, use_compress, output_folder)
    )
    thread.daemon = True
    thread.start()
    
    return jsonify({
        'success': True,
        'job_id': job_id
    })


@app.route('/api/status/<job_id>')
def get_status(job_id):
    """Get conversion status for a specific job"""
    with conversion_lock:
        if job_id not in conversion_status:
            return jsonify({'error': 'Job not found'}), 404
        
        return jsonify(conversion_status[job_id])


@app.route('/api/jobs')
def list_jobs():
    """List all conversion jobs"""
    with conversion_lock:
        jobs = list(conversion_status.values())
    
    # Sort by creation time, newest first
    jobs.sort(key=lambda x: x.get('created_time', ''), reverse=True)
    
    return jsonify(jobs)


@app.route('/api/cancel/<job_id>', methods=['POST'])
def cancel_job(job_id):
    """Cancel a running conversion job"""
    with conversion_lock:
        if job_id not in conversion_status:
            return jsonify({'error': 'Job not found'}), 404
        
        job = conversion_status[job_id]
        
        if job['status'] != 'running':
            return jsonify({'error': 'Job is not running'}), 400
        
        pid = job.get('pid')
        
        if pid:
            try:
                os.kill(pid, 15)  # SIGTERM
                job['status'] = 'cancelled'
                job['end_time'] = datetime.now().isoformat()
                return jsonify({'success': True})
            except Exception as e:
                return jsonify({'error': str(e)}), 500
        else:
            return jsonify({'error': 'No process ID found'}), 500


@app.route('/api/delete/<job_id>', methods=['DELETE'])
def delete_job(job_id):
    """Delete a job from the list"""
    with conversion_lock:
        if job_id not in conversion_status:
            return jsonify({'error': 'Job not found'}), 404
        
        del conversion_status[job_id]
    
    return jsonify({'success': True})


@app.route('/health')
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'ebook_folder': app.config['EBOOK_FOLDER'],
        'audiobook_folder': app.config['AUDIOBOOK_FOLDER'],
        'active_jobs': len([j for j in conversion_status.values() if j['status'] == 'running']),
        'auto_cleanup': app.config['AUTO_CLEANUP']
    })


@app.route('/api/cleanup/all', methods=['POST'])
def cleanup_all():
    """Manually clean up all temporary files in the audiobook directory"""
    try:
        output_path = Path(app.config['AUDIOBOOK_FOLDER'])
        if not output_path.exists():
            return jsonify({'error': 'Audiobook folder not found'}), 404
        
        deleted_count = 0
        deleted_size = 0
        
        # Remove all non-.m4b files
        for file in output_path.iterdir():
            if file.is_file() and file.suffix != '.m4b':
                file_size = file.stat().st_size
                try:
                    file.unlink()
                    deleted_count += 1
                    deleted_size += file_size
                except Exception as e:
                    print(f"Failed to delete {file.name}: {e}")
        
        return jsonify({
            'success': True,
            'files_deleted': deleted_count,
            'space_freed_mb': round(deleted_size / 1024 / 1024, 2)
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/cleanup/job/<job_id>', methods=['POST'])
def cleanup_job(job_id):
    """Manually clean up temporary files for a specific job"""
    with conversion_lock:
        if job_id not in conversion_status:
            return jsonify({'error': 'Job not found'}), 404
        
        job = conversion_status[job_id]
    
    try:
        epub_name = Path(job['epub_path']).name
        output_folder = job['output_folder']
        deleted_count = cleanup_temporary_files(output_folder, epub_name)
        
        with conversion_lock:
            conversion_status[job_id]['cleanup_files_deleted'] = deleted_count
        
        return jsonify({
            'success': True,
            'files_deleted': deleted_count
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/cleanup/status')
def cleanup_status():
    """Get information about temporary files in the audiobook directory"""
    try:
        output_path = Path(app.config['AUDIOBOOK_FOLDER'])
        if not output_path.exists():
            return jsonify({'error': 'Audiobook folder not found'}), 404
        
        temp_files = []
        temp_size = 0
        m4b_files = []
        m4b_size = 0
        
        for file in output_path.iterdir():
            if file.is_file():
                file_size = file.stat().st_size
                if file.suffix == '.m4b':
                    m4b_files.append({
                        'name': file.name,
                        'size': file_size,
                        'modified': datetime.fromtimestamp(file.stat().st_mtime).isoformat()
                    })
                    m4b_size += file_size
                else:
                    temp_files.append({
                        'name': file.name,
                        'size': file_size,
                        'extension': file.suffix,
                        'modified': datetime.fromtimestamp(file.stat().st_mtime).isoformat()
                    })
                    temp_size += file_size
        
        return jsonify({
            'auto_cleanup_enabled': app.config['AUTO_CLEANUP'],
            'audiobook_files': {
                'count': len(m4b_files),
                'total_size_mb': round(m4b_size / 1024 / 1024, 2),
                'files': sorted(m4b_files, key=lambda x: x['name'])
            },
            'temporary_files': {
                'count': len(temp_files),
                'total_size_mb': round(temp_size / 1024 / 1024, 2),
                'files': sorted(temp_files, key=lambda x: x['name'])
            }
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/config/cleanup', methods=['GET', 'POST'])
def config_cleanup():
    """Get or set auto-cleanup configuration"""
    if request.method == 'POST':
        data = request.json
        if 'auto_cleanup' in data:
            app.config['AUTO_CLEANUP'] = bool(data['auto_cleanup'])
            return jsonify({
                'success': True,
                'auto_cleanup': app.config['AUTO_CLEANUP']
            })
        return jsonify({'error': 'Missing auto_cleanup parameter'}), 400
    else:
        return jsonify({
            'auto_cleanup': app.config['AUTO_CLEANUP']
        })


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
