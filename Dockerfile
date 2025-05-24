FROM python:3.12

WORKDIR /app

COPY install_package.txt .
RUN pip install -r install_package.txt

COPY app /app

CMD ["python", "test.py"]