FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV NUT_HOST=10.255.255.28
ENV NUT_PORT=3493
ENV NUT_UPS_NAME=ups
ENV WEB_HOST=0.0.0.0
ENV WEB_PORT=8080

EXPOSE 8080

CMD ["python", "app.py"]
