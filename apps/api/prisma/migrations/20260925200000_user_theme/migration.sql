-- Per-account light/dark theme preference ("light" | "dark"; null = not chosen).
ALTER TABLE "User" ADD COLUMN "theme" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_theme_check" CHECK ("theme" IS NULL OR "theme" IN ('light', 'dark'));
