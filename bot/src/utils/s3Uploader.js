import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { config, requireConfig } from "../config.js";
import fs from 'node:fs';


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
    requireConfig("S3_BUCKET_NAME")
    requireConfig("AWS_REGION")
    const bucket = config.S3_BUCKET_NAME

    const s3 = new S3Client({
        region: config.AWS_REGION,
        credentials: fromNodeProviderChain()
    });

    logger.info(`Attempting to upload to s3 bucket:${bucket}`);
    if (!bucket) return;
    try {
        const fileStream = fs.createReadStream(localPath);
        const params = { Bucket: bucket, Key: remoteKey, Body: fileStream };

        logger.info(`Uploading to S3: ${localPath} -> s3://${bucket}/${remoteKey}`);
        await s3.send(new PutObjectCommand(params));
        logger.info(`S3 upload succeeded: ${remoteKey}`);
    } catch (err) {
        logger.error('S3 upload failed:', err);
    }
}

export default uploadFile;