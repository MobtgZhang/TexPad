FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    texlive-latex-recommended \
    texlive-fonts-recommended \
    texlive-latex-extra \
    latexmk \
    biber \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work
ENV PATH="/usr/local/bin:/usr/bin:${PATH}"
