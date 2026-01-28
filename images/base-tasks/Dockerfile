# Base Tasks Image
# Alpine with common CLI tools for general automation

FROM alpine:latest

RUN apk add --no-cache \
    bash \
    curl \
    wget \
    jq \
    yq \
    git \
    openssh-client \
    rsync \
    tar \
    gzip \
    zip \
    unzip \
    coreutils \
    findutils \
    grep \
    sed \
    gawk \
    ca-certificates \
    tzdata

# Set default timezone
ENV TZ=America/Los_Angeles

# Create workspace directory
WORKDIR /workspace

CMD ["bash"]
