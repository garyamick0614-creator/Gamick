export type UserRole = 'admin' | 'parent' | 'sitter' | 'viewer';

export interface NotificationSettings {
  newRequests: { push: boolean; email: boolean; inApp: boolean };
  requestStatus: { push: boolean; email: boolean; inApp: boolean };
  clockInOut: { push: boolean; email: boolean; inApp: boolean };
  lowSupplies: { push: boolean; email: boolean; inApp: boolean };
  newMessages: { push: boolean; email: boolean; inApp: boolean };
  photoUploads: { push: boolean; email: boolean; inApp: boolean };
  calendarReminders: { push: boolean; email: boolean; inApp: boolean };
}

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  displayName: string;
  photoURL?: string;
  batteryLevel?: number;
  lastSeen?: string;
  location?: {
    lat: number;
    lng: number;
  };
  notificationSettings?: NotificationSettings;
}

export interface CalendarEvent {
  id?: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  location?: string;
  attendees: string[]; // List of user UIDs
  createdBy: string;
  reminderMinutes?: number; // Configurable reminder
}

export interface Job {
  id?: string;
  parentUid: string;
  title: string;
  company?: string;
  location?: string;
  color?: string;
}

export interface Schedule {
  id?: string;
  uid: string; // Parent or Sitter UID
  jobId?: string; // Optional reference to a Job
  title: string;
  startTime: string;
  endTime: string;
  daysOfWeek: number[]; // 0-6 (Sun-Sat)
  recurring: boolean;
}

export interface Shift {
  id?: string;
  uid: string;
  startTime: string;
  endTime?: string;
  status: 'active' | 'completed';
  startLocation?: { lat: number; lng: number };
  endLocation?: { lat: number; lng: number };
  durationMinutes?: number;
  amountOwed?: number;
}

export interface CareRequest {
  id?: string;
  uid: string;
  type: 'food' | 'time' | 'supply' | 'other';
  status: 'pending' | 'approved' | 'rejected';
  description: string;
  cost?: number;
  timestamp: string;
}

export interface Message {
  id?: string;
  roomId: 'family' | 'shift' | 'emergency';
  text: string;
  senderUid: string;
  senderName: string;
  timestamp: string;
  type: 'text' | 'photo' | 'system';
}

export interface CarePhoto {
  id?: string;
  uid: string;
  url: string;
  timestamp: string;
  location?: { lat: number; lng: number };
  status: 'pending' | 'approved';
  caption?: string;
  aiAnalysis?: string;
}

export interface Supply {
  id?: string;
  name: string;
  stockLevel: number;
  threshold: number;
  unit: string;
}
