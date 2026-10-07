FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# pip 源：默认清华镜像，可用 --build-arg PIP_INDEX_URL=... 覆盖
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

WORKDIR /app

# 依赖单独一层：从 pyproject.toml 抽出 dependencies 安装（此时还没有源码，
# 不能用 pip install -e . —— setuptools 会因缺少 app/ 包而失败）
COPY pyproject.toml ./
RUN python -c "import tomllib; open('/tmp/req.txt','w').write('\n'.join(tomllib.load(open('pyproject.toml','rb'))['project']['dependencies']))" \
    && pip install -i "$PIP_INDEX_URL" -r /tmp/req.txt \
    && rm -f /tmp/req.txt

COPY app ./app

EXPOSE 8000

# 单 worker + 默认超时足够：SSE 空闲保护由 app/upstream.py 自行控制
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
