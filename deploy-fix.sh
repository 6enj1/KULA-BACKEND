#!/bin/bash
set -e

echo "Stopping old container..."
sudo docker stop kula-backend || true
sudo docker rm kula-backend || true

echo "Starting backend with correct DATABASE_URL..."
sudo docker run -d \
  --name kula-backend \
  -p 3000:3000 \
  -e 'DATABASE_URL=postgresql://kulaadmin:KulaDB2026Secure%21@kula-db.cj2e8u6o6bmj.af-south-1.rds.amazonaws.com:5432/kula?sslmode=no-verify' \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e 'JWT_SECRET=f491Q7sMY0wADThjmOlnCoVLVDvRgEQCI2T4z3XSEggbm709lVbkVX5kCdgu1n/j' \
  -e 'JWT_REFRESH_SECRET=zlI0tSAluQk52GNp097gJZApyfj2MGwHEPvutFnOPi3dWt2hWZ7xHMxac2nPc1YA' \
  -e 'YOCO_WEBHOOK_SECRET=whsec_RUVBRDRBOUExRjU1Njk1NkI1NjU5QTVFNERBQUIzRjc=' \
  -e 'GOOGLE_CLIENT_ID=503355923468-udjsnlm70nliks55r6ifome82gqiteom.apps.googleusercontent.com' \
  -e 'APPLE_BUNDLE_ID=ZenziAI.KULA' \
  -e 'YOCO_SECRET_KEY=sk_test_5fe5aa1ay8Z3kpW930c469c8462d' \
  --restart unless-stopped \
  kula-backend npx tsx src/index.ts

echo "Waiting for startup..."
sleep 5

echo "Recent logs:"
sudo docker logs --tail 20 kula-backend
