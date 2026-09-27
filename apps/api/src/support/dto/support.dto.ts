import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsBooleanString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export const SUBJECT_MAX = 200;
export const BODY_MAX = 5000;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const SUPPORT_CATEGORIES = ['issue', 'inquiry', 'faqs', 'custom'] as const;
export type SupportCategoryValue = (typeof SUPPORT_CATEGORIES)[number];

export class CreateConversationDto {
  @IsIn(SUPPORT_CATEGORIES, { message: 'Category must be issue, inquiry, faqs or custom' })
  category: SupportCategoryValue;

  // Required for Custom only; ignored for the other categories (their title is
  // the category name).
  @ValidateIf((o: CreateConversationDto) => o.category === 'custom')
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Title is required' })
  @MaxLength(SUBJECT_MAX, { message: `Title must be at most ${SUBJECT_MAX} characters` })
  title?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Message is required' })
  @MaxLength(BODY_MAX, { message: `Message must be at most ${BODY_MAX} characters` })
  body: string;
}

export class SendMessageDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Message is required' })
  @MaxLength(BODY_MAX, { message: `Message must be at most ${BODY_MAX} characters` })
  body: string;
}

export class AnswerResolutionDto {
  @IsBoolean({ message: 'solved must be true or false' })
  solved: boolean;
}

export class ListConversationsQueryDto {
  @IsOptional()
  @IsIn(['open', 'closed'])
  status?: 'open' | 'closed';
}

export class AdminListConversationsQueryDto extends ListConversationsQueryDto {
  // "true" = only conversations with messages the admins haven't read.
  @IsOptional()
  @IsBooleanString()
  unread?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  organizationId?: string;

  @IsOptional()
  @IsIn(SUPPORT_CATEGORIES)
  category?: SupportCategoryValue;

  // Matches the reference (e.g. "ISSUE-0003", "issue-3" or just "0003") or title.
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}
