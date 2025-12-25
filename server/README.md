# OSS Policy Service

A minimal Node.js/Express helper that signs Aliyun OSS form uploads for the mini-program front-end.

## Setup

1. Install dependencies:

   ```bash
   npm install express ali-oss cors dotenv
   ```

2. Copy `.env.example` to `.env` and fill in your OSS credentials:

   ```bash
   cp .env.example .env
   ```

3. Start the server:

   ```bash
   node app.js
   ```

4. Request a signed policy from the mini-program (POST `http://localhost:3000/api/oss/policy`) with JSON body:

   ```json
   {
     "dir": "images/",
     "expireSeconds": 60
   }
   ```

   The response contains `policy`, `signature`, `OSSAccessKeyId`, and `host`, which match the fields expected by `pages/index/index.js`.

## Notes

- `OSS_MAX_SIZE_MB` controls the maximum upload size allowed in the policy (default 10 MB).
- Environment variables should be kept private; do not expose this endpoint publicly without additional authentication.
