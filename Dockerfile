FROM python:3.12

WORKDIR /app

COPY app /app
COPY install_package.txt .

RUN pip install --upgrade pip && pip install -r install_package.txt
