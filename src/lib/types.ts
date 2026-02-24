export type AppRole = "system_admin" | "admin" | "user";
export type ThemePreference = "light" | "dark";

export type MediaType = "image" | "video";

export interface Department {
  id: string;
  name: string;
  sort_order: number;
  color_hex: string;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  email: string;
  employee_id: string | null;
  full_name: string;
  role: AppRole;
  is_active: boolean;
  theme_preference?: ThemePreference;
  created_at: string;
  updated_at: string;
}

export interface WorkItem {
  id: string;
  part_number: string;
  mold_number: string | null;
  item_title: string;
  department_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface WorkInstruction {
  id: string;
  work_item_id: string;
  body_markdown: string;
  notes_markdown: string;
  revision: number;
  is_archived: boolean;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export interface InstructionMedia {
  id: string;
  instruction_id: string;
  storage_path: string;
  public_url: string;
  media_type: MediaType;
  caption: string | null;
  sort_order: number;
  created_by: string;
  created_at: string;
}

export interface InstructionWithRelations extends WorkInstruction {
  work_items: WorkItem;
  instruction_media: InstructionMedia[];
}
