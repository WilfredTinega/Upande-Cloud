import { IsString, IsOptional, IsEnum, MinLength, Matches, ValidateIf } from 'class-validator';
import { REPO_URL_MESSAGE, REPO_URL_RE } from '../../common/repo-url.util';

export class CreateAppDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsEnum(['git', 'upload'])
  source: 'git' | 'upload';

  // Site type chosen by the user at create time. "static" = nginx-served build
  // (no server process, no DB); "node" = a long-lived Node server (dynamic, no
  // managed DB); "fullstack" = Node server + a managed Postgres provisioned at
  // deploy time; "nodered" = a managed Node-RED instance (official image, no source repo) run
  // with a persistent volume; editor accounts are managed from the app page.
  // Defaults to "static" when omitted.
  @IsOptional()
  @IsEnum(['static', 'node', 'fullstack', 'nodered'])
  type?: 'static' | 'node' | 'fullstack' | 'nodered';

  // http(s) git URL only (no local paths / file://).
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

  @IsOptional()
  @IsString()
  projectId?: string;

  // owner/repo of a connected GitHub repository. When set, the API will
  // install a push webhook so commits auto-deploy.
  @IsOptional()
  @IsString()
  githubRepoFullName?: string;
}
