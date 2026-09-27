import { IsString, MaxLength, MinLength } from 'class-validator';

// POST /apps/:id/previews — deploy (create or redeploy) a branch preview.
export class DeployPreviewDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  branch!: string;
}
