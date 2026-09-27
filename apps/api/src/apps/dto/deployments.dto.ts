import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// GET /apps/:id/deployments — deploy history page.
export class ListDeploymentsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;

  // Cursor: the id of the last deployment on the previous page.
  @IsOptional()
  @IsString()
  before?: string;
}
