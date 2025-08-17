# Dockerfile
FROM public.ecr.aws/lambda/python:3.11

# tools needed to extract the ffmpeg .tar.xz
RUN yum install -y tar xz

# ffmpeg (static)
RUN curl -L -o /tmp/ffmpeg.tar.xz https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
 && mkdir -p /opt/ffmpeg \
 && tar -xJf /tmp/ffmpeg.tar.xz -C /opt/ffmpeg --strip-components=1 \
 && ln -s /opt/ffmpeg/ffmpeg /usr/local/bin/ffmpeg \
 && ln -s /opt/ffmpeg/ffprobe /usr/local/bin/ffprobe

# (optional but helps) prefer wheels so we don't compile anything
ENV PIP_ONLY_BINARY=:all: PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1
RUN pip install --upgrade pip

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt --target "${LAMBDA_TASK_ROOT}"

ENV TRANSFORMERS_CACHE=/tmp/hf_cache
ENV HF_HOME=/tmp/hf_cache

# Pre-download the whisper model at build time (Lambda doesnt let us use disk space)
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('small', device='cpu', compute_type='int8')"

# App code
COPY *.py ${LAMBDA_TASK_ROOT}/

# Defaults (override via TF env if needed)
ENV MODEL_SIZE=small COMPUTE_TYPE=int8

CMD ["handler.lambda_handler"]
