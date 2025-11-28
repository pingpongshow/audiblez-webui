This is a fork of the audiblez ebook to audiobook project, this fork adds support for a web based GUI that is contained within a docker. 

This docker allows the use of either CPU or GPU (Nvidia/CUDA) hardware. GPU processing is many times faster.

The GUI starts with the user selecting the ebook they wish to convert and specifying the appropriate settings for the conversion process. The audiblez backend will convert the ebook to a m4b audiobook and then ffmpeg will compress the audiobook saving a great deal of space on the host system. Chapters and cover art are all preserved from the original ebook.epub

You will need to modify the docker-compose.yml file to point your volume mappings to the correct location on your host machine and modify your port if required.

The docker build process can take some time.

To install this in unraid, create a "audiblez" folder in your appdata directory throught the unraid console. You can then git clone this repository into the new audiblez directory. modify the docker-compose.yml file, this can be done by cd into the audiblez directory then "nano docker-compose.yml". You will need to modify the volume mappings to point to your host system directories for your ebooks, audiobooks and temp folders.

Once you have cloned the project, cd into the audiblez directory and issue the commands: 

"docker-compose build" this will take some time!
"docker-compose up -d" this will start the docker

Access the GUI at http://yourip:5111 (or whatever port you set)


