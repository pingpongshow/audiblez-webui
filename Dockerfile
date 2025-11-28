FROM alpine:latest

# Install ffmpeg, espeak-ng, git, python3, and pip
RUN apk add --no-cache \
    ffmpeg \
    espeak-ng \
    git \
    python3 \
    py3-pip

# Set working directory
WORKDIR /app

# Keep container running
CMD ["/bin/sh"]
