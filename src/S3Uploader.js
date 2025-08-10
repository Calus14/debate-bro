const fs = require('fs');

/**
 * Upload a local file to an S3 bucket.  Requires AWS credentials and a bucket
 * name via environment variables.  If aws-sdk isn’t installed or no bucket is
 * configured, it will silently skip the upload.
 *
 * Environment variables:
 *   S3_BUCKET_NAME (or AWS_BUCKET_NAME / S3_BUCKET) – destination bucket
 *   AWS_REGION (or S3_REGION) – region
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY – optional credentials
 */
async function uploadFile(localPath, remoteKey) {
    const bucket =
        process.env.S3_BUCKET_NAME ||
        process.env.AWS_BUCKET_NAME ||
        process.env.S3_BUCKET;
    if (!bucket) return;
    try {
        // dynamically require aws-sdk to avoid hard dependency
        let AWS;
        try {
            AWS = require('aws-sdk');
        } catch {
            console.error('aws-sdk is not installed; skipping S3 upload.');
            return;
        }
        const s3 = new AWS.S3({
            region: process.env.AWS_REGION || process.env.S3_REGION
        });
        const fileStream = fs.createReadStream(localPath);
        const params = { Bucket: bucket, Key: remoteKey, Body: fileStream };
        await s3.upload(params).promise();
    } catch (err) {
        console.error('S3 upload failed:', err);
    }
}

module.exports = { uploadFile };
