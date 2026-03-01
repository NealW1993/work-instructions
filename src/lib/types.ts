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
  icon_color?: string;
  dashboard_layout?: unknown;
  dashboard_default_layout?: unknown;
  user_settings?: unknown;
  authored_likes_seen_at?: string;
  total_signed_in_seconds?: number;
  active_session_started_at?: string | null;
  inactivity_timeout_minutes?: number | null;
  created_at: string;
  updated_at: string;
}

export interface WorkItem {
  id: string;
  part_id: string;
  item_title: string;
  department_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface WorkInstruction {
  id: string;
  work_item_id: string;
  fork_root_instruction_id?: string | null;
  fork_number?: number | null;
  merged_into_root_at?: string | null;
  merge_count?: number;
  body_markdown: string;
  notes_markdown: string;
  revision: number;
  last_change_summary?: string | null;
  ai_assisted?: boolean;
  ai_assisted_at?: string | null;
  ai_assistance_last_event_id?: string | null;
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
