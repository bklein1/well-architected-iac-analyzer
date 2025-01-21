import { Injectable } from '@nestjs/common';
import { S3 } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import * as fs from 'fs';

@Injectable()
export class StorageService {
    private readonly s3Client: S3;
    private readonly bucketName: string;

    constructor(private configService: ConfigService) {
        this.s3Client = new S3({
            region: this.configService.get('AWS_REGION'),
        });
        this.bucketName = this.configService.get('STORAGE_BUCKET_NAME');
    }

    async uploadFile(fileContent: string, fileName: string): Promise<string> {
        const fileId = this.generateFileId(fileName);
        const key = `uploads/${fileId}`;
        
        await this.s3Client.putObject({
            Bucket: this.bucketName,
            Key: key,
            Body: fileContent,
            Metadata: {
                uploadTime: new Date().toISOString()
            }
        });

        return fileId;
    }

    async getFileContent(fileId: string): Promise<string> {
        const key = `uploads/${fileId}`;
        
        const response = await this.s3Client.getObject({
            Bucket: this.bucketName,
            Key: key
        });

        return response.Body.transformToString();
    }

    async deleteExpiredFiles(): Promise<void> {
        const response = await this.s3Client.listObjects({
            Bucket: this.bucketName,
            Prefix: 'uploads/'
        });

        const now = new Date();
        const objects = response.Contents || [];

        for (const object of objects) {
            const metadata = await this.s3Client.headObject({
                Bucket: this.bucketName,
                Key: object.Key
            });

            const uploadTime = new Date(metadata.Metadata.uploadTime);
            const hoursSinceUpload = (now.getTime() - uploadTime.getTime()) / (1000 * 60 * 60);

            if (hoursSinceUpload >= 48) {
                await this.s3Client.deleteObject({
                    Bucket: this.bucketName,
                    Key: object.Key
                });
            }
        }
    }

    private generateFileId(fileName: string): string {
        const timestamp = new Date().getTime();
        const hash = createHash('md5')
            .update(`${fileName}_${timestamp}`)
            .digest('hex');
        return hash;
    }
}