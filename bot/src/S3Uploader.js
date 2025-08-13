const fs = require('fs');

// Use the global logger if available; otherwise fall back to console.  This
// allows consistent logging throughout the application without requiring
// consumers to import winston directly.  If no logger is defined,
// messages will still be output via console.
const logger = global.logger || console;

/**
 * Upload a local file to an S3 bucket. Requires AWS credentials and bucket name
 * to be provided via environment variables. If the bucket name is not set,
 * the function returns immediately. Errors are not thrown; they are logged.
 *
 * Environment variables used:
 *   - S3_BUCKET_NAME (required): the destination bucket
 *   - AWS_REGION (optional): defaults to the AWS SDK's default region
 *   - AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (optional): will fall back
 *     to the AWS SDK's default credential provider chain if not provided.
 *
 * @param {string} localPath Path to the file on disk
 * @param {string} remoteKey Key to use when storing the file in S3
 */
async function uploadFile(localPath, remoteKey) {
    const bucket = process.env.S3_BUCKET_NAME || process.env.AWS_BUCKET_NAME || process.env.S3_BUCKET;
    logger.info(`Attempting to upload to s3 bucket:${bucket}`);
    if (!bucket) return;
    try {
        // Dynamically require aws-sdk only when needed. This avoids breaking if the
        // dependency is not installed. The SDK will automatically pick up credentials
        // from environment variables, shared credentials file, or IAM roles.
        let AWS;
        try {
            AWS = require('aws-sdk');
        } catch (requireErr) {
            // Log and return if the aws-sdk cannot be loaded.  This allows the bot to
            // operate without AWS when the dependency isn't installed (e.g. in dev).
            logger.warn('aws-sdk is not installed; skipping S3 upload.');
            return;
        }
        const s3 = new AWS.S3({ region: process.env.AWS_REGION || process.env.S3_REGION });
        const fileStream = fs.createReadStream(localPath);
        const params = { Bucket: bucket, Key: remoteKey, Body: fileStream };

        // Log the upload initiation
        try {
            logger.info(`Uploading to S3: ${localPath} -> s3://${bucket}/${remoteKey}`);
        } catch {}

        await s3.upload(params).promise();
        try {
            logger.info(`S3 upload succeeded: ${remoteKey}`);
        } catch {}
    } catch (err) {
        logger.error('S3 upload failed:', err);
    }
}

module.exports = { uploadFile };