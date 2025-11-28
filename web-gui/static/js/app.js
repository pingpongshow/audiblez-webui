// Global state
let voices = {};
let selectedFile = null;
let selectedLibraryFile = null;
let currentJobs = [];
let jobRefreshInterval = null;

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    initializeTabs();
    initializeFileUpload();
    initializeSourceSelector();
    initializeVoiceSelector();
    initializeSpeedSlider();
    initializeConvertButton();
    initializeJobsTab();
    initializeSettings();
    loadVoices();
    loadSettings();
});

// Tab Navigation
function initializeTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.dataset.tab;

            // Remove active class from all
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));

            // Add active class to clicked
            button.classList.add('active');
            document.getElementById(tabName + '-tab').classList.add('active');

            // Special handling for jobs tab
            if (tabName === 'jobs') {
                loadJobs();
                startJobRefresh();
            } else {
                stopJobRefresh();
            }
            
            // Special handling for settings tab
            if (tabName === 'settings') {
                loadCleanupStatus();
            }
        });
    });
}

// Source Selection (Upload vs Library)
function initializeSourceSelector() {
    const sourceRadios = document.querySelectorAll('input[name="source"]');
    const uploadSection = document.getElementById('upload-section');
    const librarySection = document.getElementById('library-section');

    sourceRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'upload') {
                uploadSection.style.display = 'block';
                librarySection.style.display = 'none';
                selectedLibraryFile = null;
                updateConvertButton();
            } else {
                uploadSection.style.display = 'none';
                librarySection.style.display = 'block';
                selectedFile = null;
                updateConvertButton();
                loadLibrary();
            }
        });
    });
}

// File Upload
function initializeFileUpload() {
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('file-input');
    const selectedFileDiv = document.getElementById('selected-file');
    const fileName = document.getElementById('file-name');
    const clearButton = document.getElementById('clear-file');

    // Click to upload
    uploadArea.addEventListener('click', () => fileInput.click());

    // File input change
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleFileSelect(file);
    });

    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.name.endsWith('.epub')) {
            handleFileSelect(file);
        } else {
            showToast('Please select a valid .epub file', 'error');
        }
    });

    // Clear file
    clearButton.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedFile = null;
        fileInput.value = '';
        uploadArea.style.display = 'block';
        selectedFileDiv.style.display = 'none';
        updateConvertButton();
    });
}

async function handleFileSelect(file) {
    if (!file.name.endsWith('.epub')) {
        showToast('Only .epub files are supported', 'error');
        return;
    }

    showToast('Uploading file...', 'warning');

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (response.ok) {
            selectedFile = data.filepath;
            document.getElementById('file-name').textContent = data.filename;
            document.getElementById('upload-area').style.display = 'none';
            document.getElementById('selected-file').style.display = 'flex';
            showToast('File uploaded successfully', 'success');
            updateConvertButton();
        } else {
            showToast(data.error || 'Upload failed', 'error');
        }
    } catch (error) {
        showToast('Upload failed: ' + error.message, 'error');
    }
}

// Library
async function loadLibrary() {
    const libraryList = document.getElementById('library-list');
    libraryList.innerHTML = '<div class="loading">Loading library...</div>';

    try {
        const response = await fetch('/api/ebooks');
        const files = await response.json();

        if (files.length === 0) {
            libraryList.innerHTML = '<div class="empty-state">No ebooks found in /ebooks directory</div>';
            return;
        }

        libraryList.innerHTML = '';
        files.forEach(file => {
            const item = createLibraryItem(file);
            libraryList.appendChild(item);
        });
    } catch (error) {
        libraryList.innerHTML = '<div class="empty-state">Error loading library</div>';
        showToast('Failed to load library: ' + error.message, 'error');
    }
}

function createLibraryItem(file) {
    const div = document.createElement('div');
    div.className = 'library-item';
    div.dataset.path = file.path;

    const fileSize = formatFileSize(file.size);
    const modified = new Date(file.modified).toLocaleDateString();

    div.innerHTML = `
        <div class="library-item-name">${file.name}</div>
        <div class="library-item-info">${fileSize} • Modified: ${modified}</div>
    `;

    div.addEventListener('click', () => {
        // Remove selection from all items
        document.querySelectorAll('.library-item').forEach(item => {
            item.classList.remove('selected');
        });

        // Select this item
        div.classList.add('selected');
        selectedLibraryFile = file.path;
        updateConvertButton();
    });

    return div;
}

// Search library
document.getElementById('library-search')?.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const items = document.querySelectorAll('.library-item');

    items.forEach(item => {
        const name = item.querySelector('.library-item-name').textContent.toLowerCase();
        item.style.display = name.includes(searchTerm) ? 'block' : 'none';
    });
});

// Voices
async function loadVoices() {
    try {
        const response = await fetch('/api/voices');
        voices = await response.json();

        const voiceSelect = document.getElementById('voice-select');
        const defaultVoiceSelect = document.getElementById('default-voice');

        voiceSelect.innerHTML = '';
        defaultVoiceSelect.innerHTML = '';

        Object.entries(voices).forEach(([language, voiceList]) => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = language;

            voiceList.forEach(voice => {
                const option = document.createElement('option');
                option.value = voice;
                option.textContent = voice;
                optgroup.appendChild(option);
            });

            voiceSelect.appendChild(optgroup.cloneNode(true));
            defaultVoiceSelect.appendChild(optgroup);
        });

        // Set default voice
        voiceSelect.value = 'af_sky';
    } catch (error) {
        showToast('Failed to load voices: ' + error.message, 'error');
    }
}

function initializeVoiceSelector() {
    // Voice selector already initialized by loadVoices
}

// Speed Slider
function initializeSpeedSlider() {
    const speedInput = document.getElementById('speed-input');
    const speedValue = document.getElementById('speed-value');

    speedInput.addEventListener('input', (e) => {
        speedValue.textContent = parseFloat(e.target.value).toFixed(1);
    });
}

// Convert Button
function initializeConvertButton() {
    const convertBtn = document.getElementById('convert-btn');

    convertBtn.addEventListener('click', async () => {
        const source = document.querySelector('input[name="source"]:checked').value;
        const epubPath = source === 'upload' ? selectedFile : selectedLibraryFile;

        if (!epubPath) {
            showToast('Please select a file to convert', 'error');
            return;
        }

        const voice = document.getElementById('voice-select').value;
        const speed = parseFloat(document.getElementById('speed-input').value);
        const useCuda = document.getElementById('cuda-checkbox').checked;
        const useCompress = document.getElementById('compress-checkbox').checked;
        const outputFolder = document.getElementById('output-folder').value;

        const data = {
            epub_path: epubPath,
            voice: voice,
            speed: speed,
            use_cuda: useCuda,
            compress: useCompress,
            output_folder: outputFolder
        };

        try {
            convertBtn.disabled = true;
            convertBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"></circle></svg> Starting...';

            const response = await fetch('/api/convert', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });

            const result = await response.json();

            if (response.ok) {
                showToast('Conversion started successfully!', 'success');
                
                // Switch to jobs tab
                document.querySelector('[data-tab="jobs"]').click();
                
                // Reset form
                if (source === 'upload') {
                    document.getElementById('clear-file').click();
                }
            } else {
                showToast(result.error || 'Failed to start conversion', 'error');
            }
        } catch (error) {
            showToast('Failed to start conversion: ' + error.message, 'error');
        } finally {
            convertBtn.disabled = false;
            convertBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Start Conversion';
        }
    });
}

function updateConvertButton() {
    const convertBtn = document.getElementById('convert-btn');
    const source = document.querySelector('input[name="source"]:checked').value;
    const hasFile = (source === 'upload' && selectedFile) || (source === 'library' && selectedLibraryFile);

    convertBtn.disabled = !hasFile;
}

// Jobs Tab
function initializeJobsTab() {
    const refreshBtn = document.getElementById('refresh-jobs');
    refreshBtn.addEventListener('click', loadJobs);
}

async function loadJobs() {
    try {
        const response = await fetch('/api/jobs');
        currentJobs = await response.json();

        const jobsList = document.getElementById('jobs-list');

        if (currentJobs.length === 0) {
            jobsList.innerHTML = '<div class="empty-state">No conversion jobs yet</div>';
            return;
        }

        jobsList.innerHTML = '';
        currentJobs.forEach(job => {
            const jobElement = createJobElement(job);
            jobsList.appendChild(jobElement);
        });
    } catch (error) {
        showToast('Failed to load jobs: ' + error.message, 'error');
    }
}

function createJobElement(job) {
    const div = document.createElement('div');
    div.className = 'job-item';
    div.dataset.jobId = job.job_id;

    const progress = job.progress || 0;
    const statusClass = `status-${job.status}`;
    const statusText = job.status.charAt(0).toUpperCase() + job.status.slice(1);

    let actionsHTML = '';
    if (job.status === 'running') {
        actionsHTML = `
            <button class="btn btn-small btn-danger" onclick="cancelJob('${job.job_id}')">Cancel</button>
        `;
    } else if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        actionsHTML = `
            <button class="btn btn-small" onclick="deleteJob('${job.job_id}')">Delete</button>
        `;
    }

    let progressHTML = '';
    if (job.status === 'running' || job.status === 'pending') {
        const timeRemaining = job.time_remaining || 'Calculating...';
        progressHTML = `
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${progress}%"></div>
            </div>
            <div class="progress-info">
                <span>${progress}%</span>
                <span>Time remaining: ${timeRemaining}</span>
            </div>
        `;
    }
    
    // Compression progress display
    if (job.status === 'compressing' && job.compression_progress !== undefined) {
        progressHTML += `
            <div style="margin-top: 16px; font-size: 0.875rem; font-weight: 500; color: var(--primary-color);">
                Compression
            </div>
            <div class="progress-bar" style="margin-top: 8px;">
                <div class="progress-fill" style="width: ${job.compression_progress}%; background: var(--primary-color);"></div>
            </div>
            <div class="progress-info">
                <span>${job.compression_progress}%</span>
            </div>
        `;
    }
    
    // Add cleanup info for completed jobs
    let cleanupHTML = '';
    if (job.status === 'completed' && job.cleanup_files_deleted !== undefined) {
        if (job.cleanup_files_deleted > 0) {
            cleanupHTML = `<div style="font-size: 0.875rem; color: var(--success-color); margin-top: 8px;">
                ✓ Cleaned up ${job.cleanup_files_deleted} temporary files
            </div>`;
        }
    }
    
    // Add compression info for completed jobs
    let compressionHTML = '';
    if (job.status === 'completed' && job.compressed !== undefined) {
        if (job.compressed) {
            const originalMB = (job.original_size / 1024 / 1024).toFixed(1);
            const compressedMB = (job.compressed_size / 1024 / 1024).toFixed(1);
            const savedMB = (originalMB - compressedMB).toFixed(1);
            compressionHTML = `<div style="font-size: 0.875rem; color: var(--success-color); margin-top: 8px;">
                ✓ Compressed: ${originalMB} MB → ${compressedMB} MB (saved ${savedMB} MB, ${job.compression_reduction}%)
            </div>`;
        } else if (job.compression_error) {
            compressionHTML = `<div style="font-size: 0.875rem; color: var(--warning-color); margin-top: 8px;">
                ⚠ Compression failed: ${job.compression_error}
            </div>`;
        }
    }

    div.innerHTML = `
        <div class="job-header">
            <div>
                <div class="job-title">${job.epub_name}</div>
                <div class="job-meta">
                    Voice: ${job.voice} • Speed: ${job.speed}x
                    ${job.use_cuda ? ' • CUDA enabled' : ''}
                    ${job.compress ? ' • Compression enabled' : ''}
                </div>
            </div>
            <span class="job-status ${statusClass}">${statusText}</span>
        </div>
        ${progressHTML}
        ${compressionHTML}
        ${cleanupHTML}
        ${job.error ? `<div style="color: var(--error-color); margin-top: 12px; font-size: 0.875rem;">Error: ${job.error}</div>` : ''}
        ${actionsHTML ? `<div class="job-actions">${actionsHTML}</div>` : ''}
    `;

    return div;
}

async function cancelJob(jobId) {
    if (!confirm('Are you sure you want to cancel this conversion?')) {
        return;
    }

    try {
        const response = await fetch(`/api/cancel/${jobId}`, {
            method: 'POST'
        });

        const result = await response.json();

        if (response.ok) {
            showToast('Job cancelled', 'success');
            loadJobs();
        } else {
            showToast(result.error || 'Failed to cancel job', 'error');
        }
    } catch (error) {
        showToast('Failed to cancel job: ' + error.message, 'error');
    }
}

async function deleteJob(jobId) {
    try {
        const response = await fetch(`/api/delete/${jobId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (response.ok) {
            showToast('Job deleted', 'success');
            loadJobs();
        } else {
            showToast(result.error || 'Failed to delete job', 'error');
        }
    } catch (error) {
        showToast('Failed to delete job: ' + error.message, 'error');
    }
}

function startJobRefresh() {
    if (jobRefreshInterval) return;
    
    jobRefreshInterval = setInterval(() => {
        loadJobs();
    }, 2000); // Refresh every 2 seconds
}

function stopJobRefresh() {
    if (jobRefreshInterval) {
        clearInterval(jobRefreshInterval);
        jobRefreshInterval = null;
    }
}

// Settings
function initializeSettings() {
    const saveBtn = document.getElementById('save-settings');
    saveBtn.addEventListener('click', saveSettings);
    
    // Cleanup functionality
    const cleanupAllBtn = document.getElementById('cleanup-all-btn');
    const refreshCleanupBtn = document.getElementById('refresh-cleanup-status');
    const autoCleanupCheckbox = document.getElementById('auto-cleanup');
    
    cleanupAllBtn.addEventListener('click', cleanupAllFiles);
    refreshCleanupBtn.addEventListener('click', loadCleanupStatus);
    autoCleanupCheckbox.addEventListener('change', updateAutoCleanup);
    
    // Load initial cleanup status
    loadCleanupStatus();
    loadAutoCleanupConfig();
}

async function loadAutoCleanupConfig() {
    try {
        const response = await fetch('/api/config/cleanup');
        const data = await response.json();
        document.getElementById('auto-cleanup').checked = data.auto_cleanup;
    } catch (error) {
        console.error('Failed to load auto-cleanup config:', error);
    }
}

async function updateAutoCleanup() {
    const autoCleanup = document.getElementById('auto-cleanup').checked;
    
    try {
        const response = await fetch('/api/config/cleanup', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ auto_cleanup: autoCleanup })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast(
                autoCleanup ? 'Auto-cleanup enabled' : 'Auto-cleanup disabled',
                'success'
            );
        } else {
            showToast('Failed to update auto-cleanup setting', 'error');
        }
    } catch (error) {
        showToast('Failed to update auto-cleanup: ' + error.message, 'error');
    }
}

async function loadCleanupStatus() {
    try {
        const response = await fetch('/api/cleanup/status');
        const data = await response.json();
        
        const statsDiv = document.getElementById('cleanup-stats');
        
        const tempFiles = data.temporary_files.count;
        const tempSize = data.temporary_files.total_size_mb;
        const m4bFiles = data.audiobook_files.count;
        const m4bSize = data.audiobook_files.total_size_mb;
        
        statsDiv.innerHTML = `
            <div style="margin-bottom: 8px;">
                <strong>Audiobooks (.m4b):</strong> ${m4bFiles} files (${m4bSize} MB)
            </div>
            <div style="margin-bottom: 8px; ${tempFiles > 0 ? 'color: var(--warning-color);' : ''}">
                <strong>Temporary files:</strong> ${tempFiles} files (${tempSize} MB)
            </div>
            ${tempFiles > 0 ? 
                `<div style="font-size: 0.875rem; color: var(--text-secondary); margin-top: 8px;">
                    💡 ${tempSize} MB can be freed by cleaning up temporary files
                </div>` : 
                `<div style="font-size: 0.875rem; color: var(--success-color); margin-top: 8px;">
                    ✓ No temporary files found
                </div>`
            }
        `;
    } catch (error) {
        document.getElementById('cleanup-stats').innerHTML = 
            '<div style="color: var(--error-color);">Failed to load cleanup status</div>';
    }
}

async function cleanupAllFiles() {
    if (!confirm('This will delete all temporary files (non-.m4b) from the audiobook directory. Continue?')) {
        return;
    }
    
    const btn = document.getElementById('cleanup-all-btn');
    btn.disabled = true;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"></circle></svg> Cleaning...';
    
    try {
        const response = await fetch('/api/cleanup/all', {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast(
                `Cleaned up ${data.files_deleted} files (${data.space_freed_mb} MB freed)`,
                'success'
            );
            loadCleanupStatus();
        } else {
            showToast(data.error || 'Cleanup failed', 'error');
        }
    } catch (error) {
        showToast('Cleanup failed: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> Clean Up All Temporary Files';
    }
}

function loadSettings() {
    const settings = JSON.parse(localStorage.getItem('audiblez-settings') || '{}');

    if (settings.defaultVoice) {
        document.getElementById('default-voice').value = settings.defaultVoice;
        document.getElementById('voice-select').value = settings.defaultVoice;
    }

    if (settings.defaultSpeed) {
        document.getElementById('default-speed').value = settings.defaultSpeed;
        document.getElementById('speed-input').value = settings.defaultSpeed;
        document.getElementById('speed-value').textContent = parseFloat(settings.defaultSpeed).toFixed(1);
    }

    if (settings.defaultCuda !== undefined) {
        document.getElementById('default-cuda').checked = settings.defaultCuda;
        document.getElementById('cuda-checkbox').checked = settings.defaultCuda;
    }

    if (settings.defaultCompress !== undefined) {
        document.getElementById('default-compress').checked = settings.defaultCompress;
        document.getElementById('compress-checkbox').checked = settings.defaultCompress;
    }
}

function saveSettings() {
    const settings = {
        defaultVoice: document.getElementById('default-voice').value,
        defaultSpeed: parseFloat(document.getElementById('default-speed').value),
        defaultCuda: document.getElementById('default-cuda').checked,
        defaultCompress: document.getElementById('default-compress').checked
    };

    localStorage.setItem('audiblez-settings', JSON.stringify(settings));
    
    // Apply to conversion form
    document.getElementById('voice-select').value = settings.defaultVoice;
    document.getElementById('speed-input').value = settings.defaultSpeed;
    document.getElementById('speed-value').textContent = settings.defaultSpeed.toFixed(1);
    document.getElementById('cuda-checkbox').checked = settings.defaultCuda;
    document.getElementById('compress-checkbox').checked = settings.defaultCompress;

    showToast('Settings saved successfully', 'success');
}

// Utility Functions
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast show ' + type;

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Make functions globally available for onclick handlers
window.cancelJob = cancelJob;
window.deleteJob = deleteJob;
