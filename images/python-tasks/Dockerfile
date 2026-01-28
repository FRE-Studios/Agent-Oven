# Python Tasks Image
# Python 3.12 with common AI/data libraries

FROM python:3.12-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    jq \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install common Python packages
RUN pip install --no-cache-dir \
    requests \
    httpx \
    aiohttp \
    python-dotenv \
    pyyaml \
    toml \
    pandas \
    numpy \
    openai \
    anthropic \
    langchain \
    langchain-openai \
    langchain-anthropic \
    beautifulsoup4 \
    lxml \
    playwright \
    schedule \
    click \
    rich \
    typer

# Set default timezone
ENV TZ=America/Los_Angeles

# Create workspace directory
WORKDIR /workspace

CMD ["python"]
