import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
  Logger,
  UseInterceptors,
  UploadedFile, BadRequestException
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { FileUploadResponseDto } from '../../shared/dto/file-upload.dto';
import { AnalyzerService } from './analyzer.service';
import * as fs from 'fs';
import { AnalyzeRequestDto, IaCTemplateType } from '../../shared/dto/analysis.dto';

@Controller('analyzer')
export class AnalyzerController {
  private readonly logger = new Logger(AnalyzerController.name);
  private readonly uploadDir = 'temp-uploads';

  constructor(private readonly analyzerService: AnalyzerService) {
    // Ensure upload directory exists
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: './temp-uploads',
      filename: (req, file, cb) => {
        const fileId = uuidv4();
        const extension = path.extname(file.originalname);
        cb(null, `${fileId}${extension}`);
      },
    }),
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB limit
    },
  }))
  async uploadFile(@UploadedFile() file): Promise<FileUploadResponseDto> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
      return;
    }

    return {
      fileId: path.parse(file.filename).name, // Return UUID without extension
    };
  }

  @Post('analyze')
  async analyze(@Body() analyzeRequest: AnalyzeRequestDto) {
    try {
      // Read the file content from the temp uploads directory
      const filePath = path.join(this.uploadDir, analyzeRequest.fileId);
      
      if (!fs.existsSync(filePath)) {
        throw new HttpException('File not found. Please upload the file again.', HttpStatus.NOT_FOUND);
      }
      const fileContent = await fs.promises.readFile(filePath, 'utf8');

      // Clean up the temporary file after reading
      try {
        await fs.promises.unlink(filePath);
      } catch (error) {
        this.logger.warn(`Failed to delete temporary file ${filePath}: ${error}`);
      }
      return await this.analyzerService.analyze(
        fileContent,
        analyzeRequest.fileName,
        analyzeRequest.workloadId,
        analyzeRequest.selectedPillars,
        analyzeRequest.fileType
      );
    } catch (error) {
      this.logger.error('Analysis failed:', error);
      throw new HttpException(
        `Failed to analyze template: ${error.message || error}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('generate-iac')
  async generateIacDocument(@Body() body: {
    fileId: string;
    fileName: string;
    fileType: string;
    recommendations: any[];
    templateType: IaCTemplateType;
  }) {
    try {
      const result = await this.analyzerService.generateIacDocument(
        body.fileId,
        body.fileName,
        body.fileType,
        body.recommendations,
        body.templateType
      );
      return result;
    } catch (error) {
      this.logger.error('IaC generation failed:', error);
      return {
        content: '',
        isCancelled: false,
        error: error instanceof Error ? error.message : 'Failed to generate IaC document'
      };
    }
  }

  @Post('get-more-details')
  async getMoreDetails(@Body() body: {
    selectedItems: any[];
    fileContent: string;
    fileType: string;
    templateType?: IaCTemplateType;
  }) {
    try {
      const result = await this.analyzerService.getMoreDetails(
        body.selectedItems,
        body.fileContent,
        body.fileType,
        body.templateType
      );
      return result;
    } catch (error) {
      this.logger.error('Getting more details failed:', error);
      return {
        content: '',
        error: error instanceof Error ? error.message : 'Failed to get detailed analysis'
      };
    }
  }

  @Post('cancel-iac-generation')
  async cancelIaCGeneration() {
    this.analyzerService.cancelIaCGeneration();
    return { message: 'Generation cancelled successfully' };
  }

  @Post('cancel-analysis')
  async cancelAnalysis() {
    try {
      this.analyzerService.cancelAnalysis();
      return { message: 'Analysis cancelled' };
    } catch (error) {
      this.logger.error('Failed to cancel analysis:', error);
      throw new HttpException(
        `Failed to cancel analysis: ${error.message || error}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}