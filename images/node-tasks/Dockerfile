# Node Tasks Image
# Node.js LTS with common packages

FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    jq \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install common global packages
RUN npm install -g \
    typescript \
    ts-node \
    tsx \
    zx \
    axios \
    cheerio \
    puppeteer \
    playwright \
    dotenv \
    commander \
    chalk \
    ora \
    inquirer

# Set default timezone
ENV TZ=America/Los_Angeles

# Create workspace directory
WORKDIR /workspace

CMD ["node"]
