// Переменные для тестов: отдельная БД masterio_test и отдельная база Redis (db 1).
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5432/masterio_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1';
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-0123456789';
process.env.PII_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.SMS_PROVIDER = 'console';
process.env.PUSH_PROVIDER = 'log';
process.env.STRIPE_SECRET_KEY = 'sk_test_masterio_offline';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_masterio_test_secret';
process.env.QUEUE_WORKERS_ENABLED = 'true';
process.env.CORS_ORIGINS = 'http://localhost';
// S3: локальный эмулятор (moto_server или MinIO); бакет создаётся при старте
process.env.S3_ENDPOINT = process.env.TEST_S3_ENDPOINT ?? 'http://127.0.0.1:4566';
process.env.S3_BUCKET = 'masterio-test';
process.env.S3_ACCESS_KEY_ID = 'test';
process.env.S3_SECRET_ACCESS_KEY = 'test';
process.env.S3_REGION = 'us-east-1';
process.env.S3_FORCE_PATH_STYLE = 'true';
process.env.S3_CREATE_BUCKET = 'true';
