import { z } from "zod";

export const writeMode = z.enum(["read-only", "confirm-destructive", "unrestricted"]);

const pathSchema = z.string().min(1).regex(/^\//, "path must start with /");

const editorJsBlock = z.object({
  type: z.string(),
  data: z.record(z.unknown()),
});

export const pagesInput = z.object({
  action: z.enum(["list", "get", "create", "update", "delete", "move", "duplicate"]),
  path: pathSchema.optional(),
  data: z
    .object({
      title: z.string().optional(),
      variables: z.record(z.unknown()).optional(),
      blocks: z.array(editorJsBlock).optional(),
    })
    .optional(),
  target_path: pathSchema.optional(),
  recursive: z.boolean().optional(),
  confirm_token: z.string().optional(),
});

export const mediaInput = z.object({
  action: z.enum(["list", "get", "upload", "delete", "rename"]),
  path: pathSchema.optional(),
  source: z
    .object({
      base64: z.string(),
      filename: z.string(),
      mimeType: z.string(),
    })
    .optional(),
  new_name: z.string().optional(),
  confirm_token: z.string().optional(),
});

export const snippetsInput = z.object({
  action: z.enum(["list", "get", "set", "delete"]),
  name: z.string().optional(),
  scope: z.enum(["global", "local"]).optional(),
  data: z
    .object({
      variables: z.record(z.unknown()).optional(),
      blocks: z.array(editorJsBlock).optional(),
    })
    .optional(),
  confirm_token: z.string().optional(),
});

export const templatesInput = z.object({
  action: z.enum(["list", "get", "set", "delete", "validate"]),
  path: pathSchema.optional(),
  content: z.string().optional(),
  confirm_token: z.string().optional(),
});

export const configInput = z.object({
  action: z.enum(["get", "set", "validate"]),
  key: z.string().optional(),
  value: z.unknown().optional(),
  confirm_token: z.string().optional(),
});

export const themeInput = z.object({
  action: z.enum(["list", "install", "activate", "uninstall"]),
  source: z.string().optional(),
  theme: z.string().optional(),
  confirm_token: z.string().optional(),
});

export const siteInput = z.object({
  action: z.enum(["info", "search", "backup", "restore"]),
  query: z.string().optional(),
  backup_path: z.string().optional(),
  confirm_token: z.string().optional(),
});

export type PagesInput = z.infer<typeof pagesInput>;
export type MediaInput = z.infer<typeof mediaInput>;
export type SnippetsInput = z.infer<typeof snippetsInput>;
export type TemplatesInput = z.infer<typeof templatesInput>;
export type ConfigInput = z.infer<typeof configInput>;
export type ThemeInput = z.infer<typeof themeInput>;
export type SiteInput = z.infer<typeof siteInput>;
