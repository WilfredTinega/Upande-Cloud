import { IsString, IsOptional, MinLength, IsInt, Min, Max, Matches, ValidateIf, IsIn } from 'class-validator';
import { IsBoolean } from 'class-validator';
import { REPO_URL_MESSAGE, REPO_URL_RE } from '../../common/repo-url.util';

export class UpdateAppDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  // Switch between the git-built app types. Node-RED apps run a different
  // runtime (no repo/build), so they can't be switched to or from.
  @IsOptional()
  @IsIn(['static', 'node', 'fullstack'], {
    message: 'type must be one of: static, node, fullstack',
  })
  type?: 'static' | 'node' | 'fullstack';

  // "" clears it; otherwise an http(s) git URL (no local paths / file://).
  @IsOptional()
  @IsString()
  @ValidateIf((_, v) => v !== '')
  @Matches(REPO_URL_RE, { message: REPO_URL_MESSAGE })
  repoUrl?: string;

  @IsOptional()
  @IsString()
  branch?: string;

  @IsOptional()
  @IsString()
  buildCmd?: string;

  @IsOptional()
  @IsString()
  outputDir?: string;

  // Deploy health check. "" or null clears the path (web-server check only).
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsString()
  @Matches(/^\/[\x21-\x7e]{0,255}$/, {
    message: 'healthCheckPath must start with "/" and contain no spaces',
  })
  healthCheckPath?: string | null;

  // Seconds each probe may take.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  healthCheckTimeout?: number;

  // Number of probes before the deploy is failed.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  healthCheckRetries?: number;

  // GitHub PR integration toggles (apps connected to GitHub).
  @IsOptional()
  @IsBoolean()
  githubCommitStatus?: boolean;

  @IsOptional()
  @IsBoolean()
  githubPrComments?: boolean;
}
