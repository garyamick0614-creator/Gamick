/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Baby, 
  Clock, 
  MessageSquare, 
  Camera, 
  DollarSign, 
  Package, 
  Shield, 
  MapPin, 
  Battery, 
  CheckCircle2, 
  XCircle, 
  Send, 
  Plus, 
  LogOut,
  AlertTriangle,
  ChevronRight,
  TrendingUp,
  FileText,
  CreditCard,
  Calendar,
  Settings,
  Users,
  User as UserIcon,
  Briefcase,
  Bell,
  Mail,
  Smartphone,
  Trash2,
  Sparkles,
  Mic,
  Image as ImageIcon,
  Brain,
  Search,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  addDoc, 
  updateDoc, 
  serverTimestamp,
  Timestamp,
  limit,
  getDocFromServer,
  getDocs,
  deleteDoc
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { UserProfile, Shift, CareRequest, Message, CarePhoto, Supply, UserRole, CalendarEvent, Job, Schedule, NotificationSettings } from './types';
import * as aiService from './services/aiService';
import { format, formatDistanceToNow, differenceInMinutes } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Constants ---
const HOURLY_RATE = 4.75;
const HOME_LOCATION = { lat: 34.0522, lng: -118.2437 }; // Example coordinates

// --- Components ---

const Button = ({ className, variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) => {
  const variants = {
    primary: 'bg-black text-white hover:bg-zinc-800',
    secondary: 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200',
    danger: 'bg-red-500 text-white hover:bg-red-600',
    ghost: 'bg-transparent hover:bg-zinc-100'
  };
  return (
    <button 
      className={cn('px-4 py-2 rounded-xl font-medium transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none', variants[variant], className)}
      {...props}
    />
  );
};

const Card = ({ children, className, ...props }: { children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm', className)} {...props}>
    {children}
  </div>
);

const Badge = ({ children, variant = 'neutral' }: { children: React.ReactNode; variant?: 'neutral' | 'success' | 'warning' | 'error' }) => {
  const variants = {
    neutral: 'bg-zinc-100 text-zinc-600',
    success: 'bg-emerald-100 text-emerald-700',
    warning: 'bg-amber-100 text-amber-700',
    error: 'bg-red-100 text-red-700'
  };
  return <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider', variants[variant])}>{children}</span>;
};

// --- Main App ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return new Error(JSON.stringify(errInfo));
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'dashboard' | 'chat' | 'photos' | 'requests' | 'financials' | 'supplies' | 'calendar' | 'settings' | 'users' | 'jobs' | 'ai' | 'profile'>('dashboard');
  
  // Data States
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [requests, setRequests] = useState<CareRequest[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [photos, setPhotos] = useState<CarePhoto[]>([]);
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [activeShift, setActiveShift] = useState<Shift | null>(null);

  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'users', 'connection_test'));
      } catch (error: any) {
        if (error.message?.includes('offline')) {
          setError("Firestore is offline. Please check your internet connection and Firebase configuration.");
        }
      }
    };
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          setUser(firebaseUser);
          
          // Update live status (battery & location)
          const updateStatus = async () => {
            try {
              const battery = (navigator as any).getBattery ? await (navigator as any).getBattery() : null;
              const batteryLevel = battery ? Math.round(battery.level * 100) : 100;
              
              navigator.geolocation.getCurrentPosition(async (pos) => {
                await updateDoc(doc(db, 'users', firebaseUser.uid), {
                  batteryLevel,
                  lastSeen: new Date().toISOString(),
                  location: {
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude
                  }
                });
              }, async () => {
                await updateDoc(doc(db, 'users', firebaseUser.uid), {
                  batteryLevel,
                  lastSeen: new Date().toISOString()
                });
              });
            } catch (err) {
              console.error("Status update failed", err);
            }
          };

          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            setProfile(userDoc.data() as UserProfile);
            updateStatus();
          } else {
            // Check if a profile exists with this email (e.g. added by admin)
            const emailQuery = query(collection(db, 'users'), where('email', '==', firebaseUser.email));
            const emailSnap = await getDocs(emailQuery);
            
            if (!emailSnap.empty) {
              // Link the existing profile to this UID
              const existingDoc = emailSnap.docs[0];
              const existingData = existingDoc.data() as UserProfile;
              const updatedProfile = {
                ...existingData,
                uid: firebaseUser.uid, // Update to real UID
                photoURL: firebaseUser.photoURL || existingData.photoURL,
                displayName: firebaseUser.displayName || existingData.displayName
              };
              
              // Create new doc with real UID and delete temp doc if it was temp
              await setDoc(doc(db, 'users', firebaseUser.uid), updatedProfile);
              if (existingDoc.id.startsWith('temp_')) {
                await deleteDoc(doc(db, 'users', existingDoc.id));
              }
              
              setProfile(updatedProfile);
              updateStatus();
            } else {
              // Default to sitter for new users, or admin if email matches
              const role: UserRole = firebaseUser.email === 'gary.amick0614@gmail.com' ? 'admin' : 'sitter';
              const newProfile: UserProfile = {
                uid: firebaseUser.uid,
                email: firebaseUser.email || '',
                role,
                displayName: firebaseUser.displayName || 'User',
                photoURL: firebaseUser.photoURL || undefined,
                lastSeen: new Date().toISOString()
              };
              await setDoc(doc(db, 'users', firebaseUser.uid), newProfile);
              setProfile(newProfile);
              updateStatus();
            }
          }
        } else {
          setUser(null);
          setProfile(null);
        }
      } catch (err: any) {
        console.error("Auth initialization failed", err);
        setError(err.message || "Failed to initialize application");
      } finally {
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  // Real-time Listeners
  useEffect(() => {
    if (!profile) return;

    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      setUsers(snap.docs.map(d => d.data() as UserProfile));
    }, (err) => {
      setError(handleFirestoreError(err, OperationType.LIST, 'users').message);
    });

    const unsubShifts = onSnapshot(query(collection(db, 'shifts'), orderBy('startTime', 'desc')), (snap) => {
      const allShifts = snap.docs.map(d => ({ id: d.id, ...d.data() } as Shift));
      setShifts(allShifts);
      const active = allShifts.find(s => s.status === 'active' && s.uid === profile.uid);
      setActiveShift(active || null);
    }, (err) => {
      setError(handleFirestoreError(err, OperationType.LIST, 'shifts').message);
    });

    const unsubRequests = onSnapshot(query(collection(db, 'requests'), orderBy('timestamp', 'desc')), (snap) => {
      setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() } as CareRequest)));
    }, (err) => {
      setError(handleFirestoreError(err, OperationType.LIST, 'requests').message);
    });

    const unsubPhotos = onSnapshot(query(collection(db, 'photos'), orderBy('timestamp', 'desc')), (snap) => {
      setPhotos(snap.docs.map(d => ({ id: d.id, ...d.data() } as CarePhoto)));
    }, (err) => {
      setError(handleFirestoreError(err, OperationType.LIST, 'photos').message);
    });

    const unsubSupplies = onSnapshot(collection(db, 'supplies'), (snap) => {
      setSupplies(snap.docs.map(d => ({ id: d.id, ...d.data() } as Supply)));
    }, (err) => {
      setError(handleFirestoreError(err, OperationType.LIST, 'supplies').message);
    });

    const unsubEvents = onSnapshot(collection(db, 'events'), (snap) => {
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() } as CalendarEvent)));
    }, (err) => {
      setError(handleFirestoreError(err, OperationType.LIST, 'events').message);
    });

    const unsubJobs = onSnapshot(collection(db, 'jobs'), (snap) => {
      setJobs(snap.docs.map(d => ({ id: d.id, ...d.data() } as Job)));
    }, (err) => {
      setError(handleFirestoreError(err, OperationType.LIST, 'jobs').message);
    });

    const unsubSchedules = onSnapshot(collection(db, 'schedules'), (snap) => {
      setSchedules(snap.docs.map(d => ({ id: d.id, ...d.data() } as Schedule)));
    }, (err) => {
      setError(handleFirestoreError(err, OperationType.LIST, 'schedules').message);
    });

    return () => {
      unsubUsers();
      unsubShifts();
      unsubRequests();
      unsubPhotos();
      unsubSupplies();
      unsubEvents();
      unsubJobs();
      unsubSchedules();
    };
  }, [profile]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login failed', error);
    }
  };

  const handleLogout = () => {
    signOut(auth);
    setError(null);
  };

  if (loading) return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
      <motion.div 
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ repeat: Infinity, duration: 2 }}
        className="flex flex-col items-center gap-4"
      >
        <Baby className="w-12 h-12 text-zinc-900" />
        <p className="text-zinc-500 font-medium animate-pulse">Initializing Family Hub...</p>
      </motion.div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
      <Card className="max-w-md w-full text-center space-y-6 py-12 border-red-200">
        <div className="w-20 h-20 bg-red-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="w-10 h-10 text-red-500" />
        </div>
        <h1 className="text-2xl font-bold">Connection Error</h1>
        <p className="text-zinc-500 text-sm">{error}</p>
        <Button onClick={() => window.location.reload()} className="w-full">Retry Connection</Button>
        <Button variant="secondary" onClick={handleLogout} className="w-full">Sign Out</Button>
      </Card>
    </div>
  );

  if (!user || !profile) return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
      <Card className="max-w-md w-full text-center space-y-8 py-12">
        <div className="space-y-2">
          <div className="w-20 h-20 bg-zinc-900 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl">
            <Baby className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Nevaeh Care</h1>
          <p className="text-zinc-500">Secure family coordination & safety hub</p>
        </div>
        <Button onClick={handleLogin} className="w-full py-4 text-lg flex items-center justify-center gap-3">
          <Shield className="w-5 h-5" />
          Sign in with Google
        </Button>
        <p className="text-xs text-zinc-400">Authorized family members only</p>
      </Card>
    </div>
  );

  const isAdmin = profile.role === 'admin';
  const isSitter = profile.role === 'sitter';
  const isParent = profile.role === 'parent';
  const isViewer = profile.role === 'viewer';

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col md:flex-row">
      {/* Sidebar */}
      <nav className="w-full md:w-72 bg-white border-b md:border-b-0 md:border-r border-zinc-200 flex flex-col">
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center">
            <Baby className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="font-bold text-zinc-900">Amick Family</h2>
            <p className="text-[10px] text-zinc-400 uppercase tracking-widest font-bold">Care Hub v2.0</p>
          </div>
        </div>

        <div className="flex-1 px-4 space-y-1">
          <NavButton active={activeView === 'dashboard'} onClick={() => setActiveView('dashboard')} icon={<Shield className="w-5 h-5" />} label="Dashboard" />
          <NavButton active={activeView === 'chat'} onClick={() => setActiveView('chat')} icon={<MessageSquare className="w-5 h-5" />} label="Messaging" />
          <NavButton active={activeView === 'photos'} onClick={() => setActiveView('photos')} icon={<Camera className="w-5 h-5" />} label="Photo Journal" />
          <NavButton active={activeView === 'calendar'} onClick={() => setActiveView('calendar')} icon={<Calendar className="w-5 h-5" />} label="Calendar" />
          <NavButton active={activeView === 'ai'} onClick={() => setActiveView('ai')} icon={<Sparkles className="w-5 h-5" />} label="AI Assistant" />
          <NavButton active={activeView === 'requests'} onClick={() => setActiveView('requests')} icon={<Plus className="w-5 h-5" />} label="Requests" />
          <NavButton active={activeView === 'supplies'} onClick={() => setActiveView('supplies')} icon={<Package className="w-5 h-5" />} label="Supplies" />
          <NavButton active={activeView === 'profile'} onClick={() => setActiveView('profile')} icon={<UserIcon className="w-5 h-5" />} label="My Profile" />
          {isAdmin && (
            <>
              <NavButton active={activeView === 'financials'} onClick={() => setActiveView('financials')} icon={<DollarSign className="w-5 h-5" />} label="Financials" />
              <NavButton active={activeView === 'users'} onClick={() => setActiveView('users')} icon={<Users className="w-5 h-5" />} label="User Management" />
            </>
          )}
          {isParent && (
            <NavButton active={activeView === 'jobs'} onClick={() => setActiveView('jobs')} icon={<Briefcase className="w-5 h-5" />} label="Jobs & Schedules" />
          )}
          <NavButton active={activeView === 'settings'} onClick={() => setActiveView('settings')} icon={<Settings className="w-5 h-5" />} label="Settings" />
        </div>

        <div className="p-4 mt-auto border-t border-zinc-100">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-zinc-50">
            <img src={profile.photoURL || `https://ui-avatars.com/api/?name=${profile.displayName}`} className="w-10 h-10 rounded-full border border-zinc-200" />
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-bold truncate">{profile.displayName}</p>
              <p className="text-[10px] text-zinc-500 uppercase font-bold">{profile.role}</p>
            </div>
            <button onClick={handleLogout} className="p-2 text-zinc-400 hover:text-red-500 transition-colors">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-6 md:p-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeView}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {activeView === 'dashboard' && <DashboardView profile={profile} users={users} shifts={shifts} requests={requests} photos={photos} activeShift={activeShift} setActiveView={setActiveView} events={events} />}
            {activeView === 'chat' && <ChatView profile={profile} />}
            {activeView === 'photos' && <PhotoJournalView profile={profile} photos={photos} />}
            {activeView === 'calendar' && <CalendarView profile={profile} events={events} users={users} />}
            {activeView === 'requests' && <RequestsView profile={profile} requests={requests} />}
            {activeView === 'supplies' && <SuppliesView profile={profile} supplies={supplies} />}
            {activeView === 'financials' && <FinancialsView shifts={shifts} requests={requests} />}
            {activeView === 'settings' && <SettingsView profile={profile} />}
            {activeView === 'users' && <UserManagementView profile={profile} users={users} />}
            {activeView === 'jobs' && <JobsView profile={profile} jobs={jobs} schedules={schedules} />}
            {activeView === 'ai' && <AIView profile={profile} />}
            {activeView === 'profile' && <ProfileView profile={profile} />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium",
        active ? "bg-zinc-900 text-white shadow-lg shadow-zinc-200" : "text-zinc-500 hover:bg-zinc-100"
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// --- View Components ---

function CameraCapture({ onCapture, onCancel }: { onCapture: (base64: string) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function startCamera() {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 }
          } 
        });
        setStream(s);
        if (videoRef.current) videoRef.current.srcObject = s;
      } catch (err: any) {
        console.error(err);
        setError("Could not access camera. Please check permissions.");
      }
    }
    startCamera();
    return () => {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  const capture = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0);
        // Compress to JPEG to stay under 1MB
        const base64 = canvasRef.current.toDataURL('image/jpeg', 0.7);
        onCapture(base64);
      }
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black z-[100] flex flex-col"
    >
      {error ? (
        <div className="flex-1 flex flex-col items-center justify-center text-white p-6 space-y-4">
          <AlertTriangle className="w-12 h-12 text-amber-500" />
          <p>{error}</p>
          <Button onClick={onCancel}>Close</Button>
        </div>
      ) : (
        <>
          <video ref={videoRef} autoPlay playsInline className="flex-1 object-cover" />
          <canvas ref={canvasRef} className="hidden" />
          <div className="p-8 flex items-center justify-between bg-black/80 backdrop-blur-xl border-t border-white/10">
            <button onClick={onCancel} className="p-4 text-white/60 hover:text-white transition-colors">
              <XCircle className="w-8 h-8" />
            </button>
            <button 
              onClick={capture} 
              className="w-20 h-20 bg-white rounded-full border-8 border-zinc-800 shadow-2xl active:scale-95 transition-transform flex items-center justify-center"
            >
              <div className="w-14 h-14 rounded-full border-2 border-zinc-200" />
            </button>
            <div className="w-16" /> {/* Spacer */}
          </div>
        </>
      )}
    </motion.div>
  );
}

function DashboardView({ profile, users, shifts, requests, photos, activeShift, setActiveView, events }: { profile: UserProfile; users: UserProfile[]; shifts: Shift[]; requests: CareRequest[]; photos: CarePhoto[]; activeShift: Shift | null; setActiveView: (view: any) => void; events: CalendarEvent[] }) {
  const isAdmin = profile.role === 'admin';
  const isSitter = profile.role === 'sitter';
  const [aiTip, setAiTip] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<Message | null>(null);

  useEffect(() => {
    const fetchTip = async () => {
      try {
        const tip = await aiService.fastResponse("Give a very short (1 sentence) parenting or child care tip for today.");
        setAiTip(tip);
      } catch (error) {
        console.error(error);
      }
    };
    fetchTip();

    const q = query(
      collection(db, 'messages', 'family', 'chats'),
      orderBy('timestamp', 'desc'),
      limit(1)
    );
    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        setLastMessage(snap.docs[0].data() as Message);
      }
    }, (err) => {
      console.error("Dashboard last message fetch failed", err);
    });
    return unsub;
  }, []);

  const sitter = users.find(u => u.role === 'sitter');
  const pendingRequests = requests.filter(r => r.status === 'pending');
  const recentPhotos = photos.slice(0, 4);
  const upcomingEvents = events
    .filter(e => new Date(e.startTime) > new Date())
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .slice(0, 3);

  const handleClockIn = async () => {
    const newShift: Shift = {
      uid: profile.uid,
      startTime: new Date().toISOString(),
      status: 'active',
      startLocation: HOME_LOCATION
    };
    await addDoc(collection(db, 'shifts'), newShift);
  };

  const handleClockOut = async () => {
    if (!activeShift?.id) return;
    const endTime = new Date().toISOString();
    const duration = differenceInMinutes(new Date(endTime), new Date(activeShift.startTime));
    const amount = (duration / 60) * HOURLY_RATE;
    
    await updateDoc(doc(db, 'shifts', activeShift.id), {
      endTime,
      status: 'completed',
      durationMinutes: duration,
      amountOwed: amount,
      endLocation: HOME_LOCATION
    });
  };

  return (
    <div className="space-y-8">
      {aiTip && (
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="col-span-full"
        >
          <Card className="bg-gradient-to-r from-zinc-900 to-zinc-800 text-white border-0 py-4 flex items-center gap-4">
            <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-zinc-400">Daily AI Tip</p>
              <p className="text-sm font-medium italic">"{aiTip}"</p>
            </div>
          </Card>
        </motion.div>
      )}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black tracking-tight">Family Hub</h1>
          <p className="text-zinc-500">Live status for Nevaeh's care</p>
        </div>
        {isSitter && (
          <div className="flex items-center gap-3">
            {activeShift ? (
              <div className="flex items-center gap-4 bg-emerald-50 border border-emerald-100 p-2 rounded-2xl pr-4">
                <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center animate-pulse">
                  <Clock className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-emerald-600 uppercase">Live Shift</p>
                  <p className="text-sm font-black">{formatDistanceToNow(new Date(activeShift.startTime))} active</p>
                </div>
                <Button variant="danger" onClick={handleClockOut} className="ml-4">Clock Out</Button>
              </div>
            ) : (
              <Button onClick={handleClockIn} className="h-14 px-8 text-lg rounded-2xl flex items-center gap-3">
                <Clock className="w-6 h-6" />
                Clock In
              </Button>
            )}
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Status Card */}
        <Card className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <Shield className="w-5 h-5 text-zinc-400" />
              Live Status
            </h3>
            <Badge variant="success">Secure</Badge>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-zinc-100 rounded-2xl flex items-center justify-center relative">
                  <Baby className="w-8 h-8 text-zinc-900" />
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 border-2 border-white rounded-full" />
                </div>
                <div>
                  <p className="text-2xl font-black">Nevaeh Amick</p>
                  <p className="text-zinc-500 text-sm">Safe with {sitter?.displayName || 'Sitter'}</p>
                </div>
              </div>
              
              <div className="space-y-3 pt-2">
                <StatusItem 
                  icon={<MapPin className="w-4 h-4" />} 
                  label="Location" 
                  value={sitter?.location ? "At Home" : "Unknown"} 
                />
                <StatusItem icon={<Clock className="w-4 h-4" />} label="Shift Start" value={activeShift ? format(new Date(activeShift.startTime), 'h:mm a') : 'No active shift'} />
                <StatusItem icon={<DollarSign className="w-4 h-4" />} label="Owed So Far" value={activeShift ? `$${((differenceInMinutes(new Date(), new Date(activeShift.startTime)) / 60) * HOURLY_RATE).toFixed(2)}` : '$0.00'} />
              </div>
            </div>

            <div className="space-y-4 border-l border-zinc-100 pl-8">
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Sitter Status</p>
              <div className="flex items-center gap-3">
                <img src={sitter?.photoURL || `https://ui-avatars.com/api/?name=${sitter?.displayName || 'S'}`} className="w-12 h-12 rounded-full" />
                <div>
                  <p className="font-bold">{sitter?.displayName}</p>
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <Battery className="w-3 h-3" />
                    <span>{sitter?.batteryLevel || 72}% Battery</span>
                  </div>
                </div>
              </div>
              <div className="bg-zinc-50 p-3 rounded-xl">
                <p className="text-[10px] font-bold text-zinc-400 uppercase">Last Message</p>
                <p className="text-sm italic">
                  {lastMessage ? `"${lastMessage.text}"` : '"No messages yet"'}
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* Quick Actions / Alerts */}
        <div className="space-y-6">
          <Card className="bg-zinc-900 text-white border-0">
            <h3 className="font-bold mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              Pending Requests
            </h3>
            <div className="space-y-3">
              {pendingRequests.length > 0 ? pendingRequests.map(req => (
                <div key={req.id} className="bg-white/10 p-3 rounded-xl flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold">{req.type.toUpperCase()}</p>
                    <p className="text-[10px] text-white/60">{req.description}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/40" />
                </div>
              )) : (
                <p className="text-sm text-white/40 italic">No pending requests</p>
              )}
            </div>
            <Button variant="secondary" className="w-full mt-4 bg-white text-black" onClick={() => setActiveView('requests')}>View All</Button>
          </Card>

          <Card>
            <h3 className="font-bold mb-4 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-zinc-400" />
              Upcoming Events
            </h3>
            <div className="space-y-3">
              {upcomingEvents.length > 0 ? upcomingEvents.map(event => (
                <div key={event.id} className="flex items-start gap-3 p-2 hover:bg-zinc-50 rounded-xl transition-all cursor-pointer" onClick={() => setActiveView('calendar')}>
                  <div className="w-10 h-10 bg-zinc-100 rounded-xl flex flex-col items-center justify-center text-zinc-600">
                    <span className="text-[10px] font-bold uppercase">{format(new Date(event.startTime), 'MMM')}</span>
                    <span className="text-sm font-black leading-none">{format(new Date(event.startTime), 'd')}</span>
                  </div>
                  <div>
                    <p className="text-sm font-bold">{event.title}</p>
                    <p className="text-[10px] text-zinc-500">{format(new Date(event.startTime), 'h:mm a')}</p>
                  </div>
                </div>
              )) : (
                <p className="text-xs text-zinc-500 italic">No upcoming events</p>
              )}
            </div>
            <Button variant="ghost" className="w-full mt-4 text-xs" onClick={() => setActiveView('calendar')}>View Calendar</Button>
          </Card>

          <Card>
            <h3 className="font-bold mb-4">Recent Photos</h3>
            <div className="grid grid-cols-2 gap-2">
              {recentPhotos.map(photo => (
                <img key={photo.id} src={photo.url} className="w-full aspect-square object-cover rounded-lg" />
              ))}
              {recentPhotos.length === 0 && <div className="col-span-2 py-8 text-center text-zinc-400 text-xs italic">No photos yet</div>}
            </div>
            <Button variant="ghost" className="w-full mt-4 text-xs" onClick={() => setActiveView('photos')}>Open Picture Center</Button>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatusItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2 text-zinc-400">
        {icon}
        <span>{label}</span>
      </div>
      <span className="font-bold text-zinc-900">{value}</span>
    </div>
  );
}

function CalendarView({ profile, events, users }: { profile: UserProfile; events: CalendarEvent[]; users: UserProfile[] }) {
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [newEvent, setNewEvent] = useState<Partial<CalendarEvent>>({
    title: '',
    startTime: new Date().toISOString().slice(0, 16),
    endTime: new Date(Date.now() + 3600000).toISOString().slice(0, 16),
    attendees: [profile.uid],
    reminderMinutes: 30
  });

  const handleAddEvent = async () => {
    if (!newEvent.title || !newEvent.startTime || !newEvent.endTime) return;
    await addDoc(collection(db, 'events'), {
      ...newEvent,
      createdBy: profile.uid,
      timestamp: new Date().toISOString()
    });
    setShowAddEvent(false);
    setNewEvent({
      title: '',
      startTime: new Date().toISOString().slice(0, 16),
      endTime: new Date(Date.now() + 3600000).toISOString().slice(0, 16),
      attendees: [profile.uid],
      reminderMinutes: 30
    });
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black">Family Calendar</h2>
          <p className="text-zinc-500">Shared events and reminders</p>
        </div>
        <Button onClick={() => setShowAddEvent(true)} className="flex items-center gap-2">
          <Plus className="w-5 h-5" />
          Add Event
        </Button>
      </header>

      {showAddEvent && (
        <Card className="space-y-4 border-zinc-900 border-2">
          <h3 className="font-bold">New Event</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-zinc-400">Title</label>
              <input 
                type="text" 
                value={newEvent.title} 
                onChange={e => setNewEvent({ ...newEvent, title: e.target.value })}
                className="w-full p-3 bg-zinc-50 rounded-xl border-0 focus:ring-2 focus:ring-black"
                placeholder="Event name"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-zinc-400">Location</label>
              <input 
                type="text" 
                value={newEvent.location} 
                onChange={e => setNewEvent({ ...newEvent, location: e.target.value })}
                className="w-full p-3 bg-zinc-50 rounded-xl border-0 focus:ring-2 focus:ring-black"
                placeholder="Where?"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-zinc-400">Start Time</label>
              <input 
                type="datetime-local" 
                value={newEvent.startTime} 
                onChange={e => setNewEvent({ ...newEvent, startTime: e.target.value })}
                className="w-full p-3 bg-zinc-50 rounded-xl border-0 focus:ring-2 focus:ring-black"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-zinc-400">End Time</label>
              <input 
                type="datetime-local" 
                value={newEvent.endTime} 
                onChange={e => setNewEvent({ ...newEvent, endTime: e.target.value })}
                className="w-full p-3 bg-zinc-50 rounded-xl border-0 focus:ring-2 focus:ring-black"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-zinc-400">Reminder (minutes before)</label>
              <input 
                type="number" 
                value={newEvent.reminderMinutes} 
                onChange={e => setNewEvent({ ...newEvent, reminderMinutes: parseInt(e.target.value) })}
                className="w-full p-3 bg-zinc-50 rounded-xl border-0 focus:ring-2 focus:ring-black"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setShowAddEvent(false)}>Cancel</Button>
            <Button onClick={handleAddEvent}>Create Event</Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {events.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()).map(event => (
          <Card key={event.id} className="space-y-4 hover:border-zinc-900 transition-all">
            <div className="flex items-start justify-between">
              <div className="w-12 h-12 bg-zinc-100 rounded-2xl flex flex-col items-center justify-center text-zinc-900">
                <span className="text-xs font-bold uppercase">{format(new Date(event.startTime), 'MMM')}</span>
                <span className="text-lg font-black leading-none">{format(new Date(event.startTime), 'd')}</span>
              </div>
              <Badge variant={new Date(event.startTime) < new Date() ? 'neutral' : 'success'}>
                {new Date(event.startTime) < new Date() ? 'Past' : 'Upcoming'}
              </Badge>
            </div>
            <div>
              <h3 className="text-xl font-black">{event.title}</h3>
              <p className="text-zinc-500 text-sm flex items-center gap-1 mt-1">
                <Clock className="w-3 h-3" />
                {format(new Date(event.startTime), 'h:mm a')} - {format(new Date(event.endTime), 'h:mm a')}
              </p>
              {event.location && (
                <p className="text-zinc-500 text-sm flex items-center gap-1 mt-1">
                  <MapPin className="w-3 h-3" />
                  {event.location}
                </p>
              )}
            </div>
            <div className="pt-4 border-t border-zinc-100 flex items-center justify-between">
              <div className="flex -space-x-2">
                {event.attendees.map(uid => {
                  const attendee = users.find(u => u.uid === uid);
                  return (
                    <img 
                      key={uid} 
                      src={attendee?.photoURL || `https://ui-avatars.com/api/?name=${attendee?.displayName || 'U'}`} 
                      className="w-8 h-8 rounded-full border-2 border-white" 
                      title={attendee?.displayName}
                    />
                  );
                })}
              </div>
              {event.reminderMinutes && (
                <div className="flex items-center gap-1 text-[10px] font-bold text-zinc-400 uppercase">
                  <Bell className="w-3 h-3" />
                  {event.reminderMinutes}m reminder
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SettingsView({ profile }: { profile: UserProfile }) {
  const [settings, setSettings] = useState<NotificationSettings>(profile.notificationSettings || {
    newRequests: { push: true, email: true, inApp: true },
    requestStatus: { push: true, email: true, inApp: true },
    clockInOut: { push: true, email: false, inApp: true },
    lowSupplies: { push: true, email: true, inApp: true },
    newMessages: { push: true, email: false, inApp: true },
    photoUploads: { push: false, email: false, inApp: true },
    calendarReminders: { push: true, email: true, inApp: true }
  });

  const handleToggle = async (key: keyof NotificationSettings, type: 'push' | 'email' | 'inApp') => {
    const newSettings = {
      ...settings,
      [key]: { ...settings[key], [type]: !settings[key][type] }
    };
    setSettings(newSettings);
    await updateDoc(doc(db, 'users', profile.uid), { notificationSettings: newSettings });
  };

  const SettingRow = ({ label, icon, settingKey }: { label: string; icon: React.ReactNode; settingKey: keyof NotificationSettings }) => (
    <div className="flex items-center justify-between py-4 border-b border-zinc-100 last:border-0">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-zinc-100 rounded-xl flex items-center justify-center text-zinc-600">
          {icon}
        </div>
        <div>
          <p className="font-bold">{label}</p>
          <p className="text-xs text-zinc-500">Configure how you receive alerts</p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <button onClick={() => handleToggle(settingKey, 'inApp')} className={cn("p-2 rounded-lg transition-all", settings[settingKey].inApp ? "bg-black text-white" : "bg-zinc-100 text-zinc-400")}>
          <Bell className="w-4 h-4" />
        </button>
        <button onClick={() => handleToggle(settingKey, 'push')} className={cn("p-2 rounded-lg transition-all", settings[settingKey].push ? "bg-black text-white" : "bg-zinc-100 text-zinc-400")}>
          <Smartphone className="w-4 h-4" />
        </button>
        <button onClick={() => handleToggle(settingKey, 'email')} className={cn("p-2 rounded-lg transition-all", settings[settingKey].email ? "bg-black text-white" : "bg-zinc-100 text-zinc-400")}>
          <Mail className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <header>
        <h2 className="text-3xl font-black">Notification Settings</h2>
        <p className="text-zinc-500">Manage your alert preferences</p>
      </header>

      <Card className="divide-y divide-zinc-100">
        <SettingRow label="New Requests" icon={<Plus className="w-5 h-5" />} settingKey="newRequests" />
        <SettingRow label="Request Status" icon={<CheckCircle2 className="w-5 h-5" />} settingKey="requestStatus" />
        <SettingRow label="Clock In/Out" icon={<Clock className="w-5 h-5" />} settingKey="clockInOut" />
        <SettingRow label="Low Supplies" icon={<AlertTriangle className="w-5 h-5" />} settingKey="lowSupplies" />
        <SettingRow label="New Messages" icon={<MessageSquare className="w-5 h-5" />} settingKey="newMessages" />
        <SettingRow label="Photo Uploads" icon={<Camera className="w-5 h-5" />} settingKey="photoUploads" />
        <SettingRow label="Calendar Reminders" icon={<Calendar className="w-5 h-5" />} settingKey="calendarReminders" />
      </Card>
    </div>
  );
}

function UserManagementView({ profile, users }: { profile: UserProfile; users: UserProfile[] }) {
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', displayName: '', role: 'sitter' as UserRole });

  const handleAddUser = async () => {
    if (!newUser.email || !newUser.displayName) return;
    // In a real app, this might involve Firebase Admin or a cloud function to create the user account
    // For this demo, we'll just add the profile to the users collection
    // Note: The user still needs to sign in with this email to link the account
    const tempUid = `temp_${Date.now()}`;
    await setDoc(doc(db, 'users', tempUid), {
      uid: tempUid,
      email: newUser.email,
      displayName: newUser.displayName,
      role: newUser.role,
      lastSeen: new Date().toISOString()
    });
    setShowAddUser(false);
    setNewUser({ email: '', displayName: '', role: 'sitter' });
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black">User Management</h2>
          <p className="text-zinc-500">Manage family members and care providers</p>
        </div>
        <Button onClick={() => setShowAddUser(true)} className="flex items-center gap-2">
          <Users className="w-5 h-5" />
          Add User
        </Button>
      </header>

      {showAddUser && (
        <Card className="space-y-4 border-zinc-900 border-2">
          <h3 className="font-bold">Add New User</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-zinc-400">Name</label>
              <input 
                type="text" 
                value={newUser.displayName} 
                onChange={e => setNewUser({ ...newUser, displayName: e.target.value })}
                className="w-full p-3 bg-zinc-50 rounded-xl border-0 focus:ring-2 focus:ring-black"
                placeholder="Full Name"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-zinc-400">Email</label>
              <input 
                type="email" 
                value={newUser.email} 
                onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                className="w-full p-3 bg-zinc-50 rounded-xl border-0 focus:ring-2 focus:ring-black"
                placeholder="email@example.com"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-zinc-400">Role</label>
              <select 
                value={newUser.role} 
                onChange={e => setNewUser({ ...newUser, role: e.target.value as UserRole })}
                className="w-full p-3 bg-zinc-50 rounded-xl border-0 focus:ring-2 focus:ring-black"
              >
                <option value="sitter">Sitter</option>
                <option value="parent">Parent</option>
                <option value="viewer">Viewer</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setShowAddUser(false)}>Cancel</Button>
            <Button onClick={handleAddUser}>Add User</Button>
          </div>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-zinc-50 border-b border-zinc-100">
            <tr>
              <th className="px-6 py-4 text-xs font-bold uppercase text-zinc-400">User</th>
              <th className="px-6 py-4 text-xs font-bold uppercase text-zinc-400">Role</th>
              <th className="px-6 py-4 text-xs font-bold uppercase text-zinc-400">Last Seen</th>
              <th className="px-6 py-4 text-xs font-bold uppercase text-zinc-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {users.map(user => (
              <tr key={user.uid} className="hover:bg-zinc-50 transition-all">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`} className="w-10 h-10 rounded-full" />
                    <div>
                      <p className="font-bold">{user.displayName}</p>
                      <p className="text-xs text-zinc-500">{user.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <Badge variant={user.role === 'admin' ? 'error' : user.role === 'parent' ? 'success' : 'neutral'}>
                    {user.role}
                  </Badge>
                </td>
                <td className="px-6 py-4 text-sm text-zinc-500">
                  {user.lastSeen ? formatDistanceToNow(new Date(user.lastSeen)) + ' ago' : 'Never'}
                </td>
                <td className="px-6 py-4">
                  <Button variant="ghost" className="p-2 text-zinc-400 hover:text-red-500">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function JobsView({ profile, jobs, schedules }: { profile: UserProfile; jobs: Job[]; schedules: Schedule[] }) {
  const [showAddJob, setShowAddJob] = useState(false);
  const [showAddSchedule, setShowAddSchedule] = useState(false);
  const [newJob, setNewJob] = useState<Partial<Job>>({ title: '', company: '', color: '#000000' });
  const [newSchedule, setNewSchedule] = useState<Partial<Schedule>>({ 
    title: '', 
    startTime: '09:00', 
    endTime: '17:00', 
    daysOfWeek: [1, 2, 3, 4, 5], 
    recurring: true 
  });

  const handleAddJob = async () => {
    if (!newJob.title) return;
    await addDoc(collection(db, 'jobs'), { ...newJob, parentUid: profile.uid });
    setShowAddJob(false);
    setNewJob({ title: '', company: '', color: '#000000' });
  };

  const handleAddSchedule = async () => {
    if (!newSchedule.title) return;
    await addDoc(collection(db, 'schedules'), { ...newSchedule, uid: profile.uid });
    setShowAddSchedule(false);
    setNewSchedule({ title: '', startTime: '09:00', endTime: '17:00', daysOfWeek: [1, 2, 3, 4, 5], recurring: true });
  };

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black">Jobs & Schedules</h2>
          <p className="text-zinc-500">Manage your work commitments</p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => setShowAddJob(true)} className="flex items-center gap-2">
            <Briefcase className="w-5 h-5" />
            Add Job
          </Button>
          <Button onClick={() => setShowAddSchedule(true)} className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Add Schedule
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-6">
          <h3 className="text-xl font-black flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-zinc-400" />
            Active Jobs
          </h3>
          {showAddJob && (
            <Card className="space-y-4 border-zinc-900 border-2">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-zinc-400">Job Title</label>
                <input 
                  type="text" 
                  value={newJob.title} 
                  onChange={e => setNewJob({ ...newJob, title: e.target.value })}
                  className="w-full p-3 bg-zinc-50 rounded-xl border-0 focus:ring-2 focus:ring-black"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-zinc-400">Company</label>
                <input 
                  type="text" 
                  value={newJob.company} 
                  onChange={e => setNewJob({ ...newJob, company: e.target.value })}
                  className="w-full p-3 bg-zinc-50 rounded-xl border-0 focus:ring-2 focus:ring-black"
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button variant="secondary" onClick={() => setShowAddJob(false)}>Cancel</Button>
                <Button onClick={handleAddJob}>Save Job</Button>
              </div>
            </Card>
          )}
          <div className="grid grid-cols-1 gap-4">
            {jobs.filter(j => j.parentUid === profile.uid).map(job => (
              <Card key={job.id} className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-zinc-100 rounded-2xl flex items-center justify-center text-zinc-900">
                    <Briefcase className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="font-bold text-lg">{job.title}</p>
                    <p className="text-sm text-zinc-500">{job.company}</p>
                  </div>
                </div>
                <Button variant="ghost" className="p-2 text-zinc-400 hover:text-red-500">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </Card>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <h3 className="text-xl font-black flex items-center gap-2">
            <Clock className="w-5 h-5 text-zinc-400" />
            Weekly Schedule
          </h3>
          {showAddSchedule && (
            <Card className="space-y-4 border-zinc-900 border-2">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-zinc-400">Schedule Title</label>
                <input 
                  type="text" 
                  value={newSchedule.title} 
                  onChange={e => setNewSchedule({ ...newSchedule, title: e.target.value })}
                  className="w-full p-3 bg-zinc-50 rounded-xl border-0 focus:ring-2 focus:ring-black"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-zinc-400">Start Time</label>
                  <input 
                    type="time" 
                    value={newSchedule.startTime} 
                    onChange={e => setNewSchedule({ ...newSchedule, startTime: e.target.value })}
                    className="w-full p-3 bg-zinc-50 rounded-xl border-0 focus:ring-2 focus:ring-black"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-zinc-400">End Time</label>
                  <input 
                    type="time" 
                    value={newSchedule.endTime} 
                    onChange={e => setNewSchedule({ ...newSchedule, endTime: e.target.value })}
                    className="w-full p-3 bg-zinc-50 rounded-xl border-0 focus:ring-2 focus:ring-black"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button variant="secondary" onClick={() => setShowAddSchedule(false)}>Cancel</Button>
                <Button onClick={handleAddSchedule}>Save Schedule</Button>
              </div>
            </Card>
          )}
          <div className="space-y-4">
            {schedules.filter(s => s.uid === profile.uid).map(schedule => (
              <Card key={schedule.id} className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-bold">{schedule.title}</p>
                  <Badge variant="success">{schedule.recurring ? 'Recurring' : 'One-time'}</Badge>
                </div>
                <div className="flex items-center gap-4 text-sm text-zinc-500">
                  <div className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    {schedule.startTime} - {schedule.endTime}
                  </div>
                  <div className="flex gap-1">
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
                      <div key={i} className={cn("w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold", schedule.daysOfWeek.includes(i) ? "bg-black text-white" : "bg-zinc-100 text-zinc-400")}>
                        {day}
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
function ChatView({ profile }: { profile: UserProfile }) {
  const [activeRoom, setActiveRoom] = useState<'family' | 'shift' | 'emergency'>('family');
  const [msgText, setMsgText] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'messages', activeRoom, 'chats'),
      orderBy('timestamp', 'asc'),
      limit(50)
    );
    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() } as Message)));
      setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }, (err) => {
      console.error("Chat messages fetch failed", err);
    });
    return unsub;
  }, [activeRoom]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!msgText.trim()) return;
    
    const newMsg: Message = {
      roomId: activeRoom,
      text: msgText,
      senderUid: profile.uid,
      senderName: profile.displayName,
      timestamp: new Date().toISOString(),
      type: 'text'
    };
    
    await addDoc(collection(db, 'messages', activeRoom, 'chats'), newMsg);
    setMsgText('');
  };

  return (
    <div className="h-[calc(100vh-12rem)] flex flex-col bg-white border border-zinc-200 rounded-3xl overflow-hidden">
      <div className="p-4 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
        <div className="flex gap-2">
          <RoomTab active={activeRoom === 'family'} onClick={() => setActiveRoom('family')} label="Family Room" />
          <RoomTab active={activeRoom === 'shift'} onClick={() => setActiveRoom('shift')} label="Shift Log" />
          <RoomTab active={activeRoom === 'emergency'} onClick={() => setActiveRoom('emergency')} label="Emergency" variant="danger" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={cn("flex flex-col", msg.senderUid === profile.uid ? "items-end" : "items-start")}>
            <div className={cn(
              "max-w-[80%] p-4 rounded-2xl shadow-sm",
              msg.senderUid === profile.uid ? "bg-zinc-900 text-white rounded-tr-none" : "bg-zinc-100 text-zinc-900 rounded-tl-none"
            )}>
              <p className="text-[10px] font-bold opacity-60 mb-1">{msg.senderName} • {format(new Date(msg.timestamp), 'h:mm a')}</p>
              <p className="text-sm">{msg.text}</p>
            </div>
          </div>
        ))}
        <div ref={scrollRef} />
      </div>

      <form onSubmit={handleSend} className="p-4 border-t border-zinc-100 flex gap-3">
        <VoiceRecorder onTranscription={(text) => setMsgText(prev => prev + (prev ? ' ' : '') + text)} />
        <input 
          value={msgText}
          onChange={(e) => setMsgText(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 bg-zinc-100 border-0 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-zinc-900 outline-none"
        />
        <Button type="submit" className="rounded-xl px-6">
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
}

function RoomTab({ active, onClick, label, variant = 'default' }: { active: boolean; onClick: () => void; label: string; variant?: 'default' | 'danger' }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "px-4 py-2 rounded-xl text-xs font-bold transition-all",
        active 
          ? (variant === 'danger' ? "bg-red-500 text-white" : "bg-zinc-900 text-white") 
          : "text-zinc-400 hover:text-zinc-600"
      )}
    >
      {label}
    </button>
  );
}

function PhotoJournalView({ profile, photos }: { profile: UserProfile; photos: CarePhoto[] }) {
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isAdmin = profile.role === 'admin';

  const savePhoto = async (base64: string) => {
    setUploading(true);
    const newPhoto: CarePhoto = {
      uid: profile.uid,
      url: base64,
      timestamp: new Date().toISOString(),
      status: isAdmin ? 'approved' : 'pending',
      caption: caption || 'New photo'
    };
    
    try {
      await addDoc(collection(db, 'photos'), newPhoto);
      setCaption('');
      setShowCamera(false);
    } catch (error) {
      console.error("Upload failed", error);
      alert("Photo too large or upload failed. Firestore limit is 1MB.");
    } finally {
      setUploading(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onloadend = async () => {
      await savePhoto(reader.result as string);
    };
  };

  const analyzePhoto = async (photo: CarePhoto) => {
    setAnalyzing(photo.id!);
    try {
      const response = await fetch(photo.url);
      const blob = await response.blob();
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const analysis = await aiService.analyzeCarePhoto(base64, blob.type);
        await updateDoc(doc(db, 'photos', photo.id!), { aiAnalysis: analysis });
      };
    } catch (error) {
      console.error(error);
    } finally {
      setAnalyzing(null);
    }
  };

  const approvePhoto = async (id: string) => {
    await updateDoc(doc(db, 'photos', id), { status: 'approved' });
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black tracking-tight">Picture Center</h1>
          <p className="text-zinc-500">Live care documentation</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <input 
            type="text" 
            placeholder="Add a caption..." 
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            className="bg-zinc-100 border-0 rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-black outline-none"
          />
          <input 
            type="file" 
            accept="image/*" 
            className="hidden" 
            ref={fileInputRef}
            onChange={handleUpload}
          />
          <div className="flex gap-2">
            <Button onClick={() => setShowCamera(true)} disabled={uploading} className="flex-1 h-14 px-6 rounded-2xl flex items-center justify-center gap-3">
              <Camera className="w-6 h-6" />
              Camera
            </Button>
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="flex-1 h-14 px-6 rounded-2xl flex items-center justify-center gap-3">
              <ImageIcon className="w-6 h-6" />
              Gallery
            </Button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {showCamera && (
          <CameraCapture 
            onCapture={savePhoto} 
            onCancel={() => setShowCamera(false)} 
          />
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {photos.map(photo => (
          <Card key={photo.id} className="p-0 overflow-hidden group">
            <div className="relative aspect-square">
              <img src={photo.url} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              <div className="absolute top-4 right-4">
                <Badge variant={photo.status === 'approved' ? 'success' : 'warning'}>
                  {photo.status}
                </Badge>
              </div>
            </div>
            <div className="p-4 space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-zinc-400 font-bold">{format(new Date(photo.timestamp), 'MMM d, h:mm a')}</p>
                  {isAdmin && photo.status === 'pending' && (
                    <Button onClick={() => approvePhoto(photo.id!)} className="py-1 px-3 text-[10px]">Approve</Button>
                  )}
                </div>
                <p className="text-sm font-medium">{photo.caption}</p>
              </div>

              {photo.aiAnalysis ? (
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                  <p className="text-[10px] font-bold text-emerald-600 uppercase mb-1 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    AI Analysis
                  </p>
                  <p className="text-xs text-emerald-800 italic leading-relaxed">{photo.aiAnalysis}</p>
                </div>
              ) : (
                <Button 
                  onClick={() => analyzePhoto(photo)} 
                  disabled={analyzing === photo.id}
                  variant="secondary" 
                  className="w-full py-2 text-[10px] flex items-center justify-center gap-2"
                >
                  {analyzing === photo.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Brain className="w-3 h-3" />}
                  Analyze with AI
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function RequestsView({ profile, requests }: { profile: UserProfile; requests: CareRequest[] }) {
  const [showAdd, setShowAdd] = useState(false);
  const [type, setType] = useState<CareRequest['type']>('food');
  const [desc, setDesc] = useState('');
  const [cost, setCost] = useState('');
  const isAdmin = profile.role === 'admin';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newReq: CareRequest = {
      uid: profile.uid,
      type,
      status: 'pending',
      description: desc,
      cost: cost ? parseFloat(cost) : undefined,
      timestamp: new Date().toISOString()
    };
    await addDoc(collection(db, 'requests'), newReq);
    setShowAdd(false);
    setDesc('');
    setCost('');
  };

  const handleAction = async (id: string, status: 'approved' | 'rejected') => {
    await updateDoc(doc(db, 'requests', id), { status });
  };

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-black tracking-tight">Requests</h1>
          <p className="text-zinc-500">Food, supplies, and time-off</p>
        </div>
        <Button onClick={() => setShowAdd(true)} className="h-14 px-8 rounded-2xl flex items-center gap-3">
          <Plus className="w-6 h-6" />
          New Request
        </Button>
      </header>

      {showAdd && (
        <Card className="border-2 border-zinc-900">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-zinc-400">Type</label>
                <select 
                  value={type} 
                  onChange={(e) => setType(e.target.value as any)}
                  className="w-full bg-zinc-100 border-0 rounded-xl px-4 py-3 text-sm outline-none"
                >
                  <option value="food">Food / Grocery</option>
                  <option value="supply">Supply / Diapers</option>
                  <option value="time">Time Off / Extra Hours</option>
                  <option value="other">Other / Meds</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-zinc-400">Cost (Optional)</label>
                <input 
                  type="number" 
                  step="0.01"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-zinc-100 border-0 rounded-xl px-4 py-3 text-sm outline-none"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-zinc-400">Description</label>
              <textarea 
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Explain what is needed..."
                className="w-full bg-zinc-100 border-0 rounded-xl px-4 py-3 text-sm outline-none h-24"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="secondary" type="button" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button type="submit">Submit Request</Button>
            </div>
          </form>
        </Card>
      )}

      <div className="space-y-4">
        {requests.map(req => (
          <Card key={req.id} className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center",
                req.type === 'food' ? "bg-amber-100 text-amber-600" :
                req.type === 'supply' ? "bg-blue-100 text-blue-600" :
                req.type === 'time' ? "bg-purple-100 text-purple-600" : "bg-zinc-100 text-zinc-600"
              )}>
                {req.type === 'food' ? <AlertTriangle className="w-6 h-6" /> : <Package className="w-6 h-6" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-bold">{req.description}</p>
                  <Badge variant={req.status === 'approved' ? 'success' : req.status === 'rejected' ? 'error' : 'warning'}>
                    {req.status}
                  </Badge>
                </div>
                <p className="text-xs text-zinc-400">{format(new Date(req.timestamp), 'MMM d, h:mm a')} • {req.type.toUpperCase()}</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {req.cost && <p className="font-black text-lg">${req.cost.toFixed(2)}</p>}
              {isAdmin && req.status === 'pending' && (
                <div className="flex gap-2">
                  <button onClick={() => handleAction(req.id!, 'approved')} className="p-2 text-emerald-500 hover:bg-emerald-50 rounded-lg transition-colors"><CheckCircle2 className="w-6 h-6" /></button>
                  <button onClick={() => handleAction(req.id!, 'rejected')} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"><XCircle className="w-6 h-6" /></button>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SuppliesView({ profile, supplies }: { profile: UserProfile; supplies: Supply[] }) {
  const isAdmin = profile.role === 'admin';

  const updateStock = async (id: string, delta: number) => {
    const supply = supplies.find(s => s.id === id);
    if (!supply) return;
    await updateDoc(doc(db, 'supplies', id), { stockLevel: Math.max(0, supply.stockLevel + delta) });
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-4xl font-black tracking-tight">Supplies</h1>
        <p className="text-zinc-500">Inventory tracking & low stock alerts</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {supplies.map(supply => (
          <Card key={supply.id} className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center",
                supply.stockLevel <= supply.threshold ? "bg-red-100 text-red-600 animate-pulse" : "bg-zinc-100 text-zinc-600"
              )}>
                <Package className="w-6 h-6" />
              </div>
              <div>
                <p className="font-bold">{supply.name}</p>
                <p className="text-xs text-zinc-400">Threshold: {supply.threshold} {supply.unit}</p>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-right">
                <p className={cn("text-2xl font-black", supply.stockLevel <= supply.threshold ? "text-red-500" : "text-zinc-900")}>
                  {supply.stockLevel}
                </p>
                <p className="text-[10px] font-bold uppercase text-zinc-400">{supply.unit}</p>
              </div>
              <div className="flex flex-col gap-1">
                <button onClick={() => updateStock(supply.id!, 1)} className="p-1 hover:bg-zinc-100 rounded"><Plus className="w-4 h-4" /></button>
                <button onClick={() => updateStock(supply.id!, -1)} className="p-1 hover:bg-zinc-100 rounded"><LogOut className="w-4 h-4 rotate-90" /></button>
              </div>
            </div>
          </Card>
        ))}
        {supplies.length === 0 && (
          <div className="col-span-2 py-12 text-center border-2 border-dashed border-zinc-200 rounded-3xl">
             <p className="text-zinc-400 italic">No supplies tracked yet. Add some in the database.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function FinancialsView({ shifts, requests }: { shifts: Shift[]; requests: CareRequest[] }) {
  const completedShifts = shifts.filter(s => s.status === 'completed');
  const approvedRequests = requests.filter(r => r.status === 'approved' && r.cost);
  
  const totalEarned = completedShifts.reduce((acc, s) => acc + (s.amountOwed || 0), 0);
  const totalReimbursed = approvedRequests.reduce((acc, r) => acc + (r.cost || 0), 0);
  const totalSpent = totalEarned + totalReimbursed;

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-black tracking-tight">Financial Center</h1>
          <p className="text-zinc-500">Payroll & expense tracking</p>
        </div>
        <Button className="flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Export 1099-NEC
        </Button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard label="YTD Total Spent" value={`$${totalSpent.toFixed(2)}`} icon={<TrendingUp className="w-5 h-5" />} />
        <StatCard label="This Month Payroll" value={`$${totalEarned.toFixed(2)}`} icon={<DollarSign className="w-5 h-5" />} />
        <StatCard label="Pending Reimbursements" value={`$${totalReimbursed.toFixed(2)}`} icon={<CreditCard className="w-5 h-5" />} />
      </div>

      <Card>
        <h3 className="font-bold mb-6">Recent Transactions</h3>
        <div className="space-y-4">
          {completedShifts.slice(0, 5).map(shift => (
            <div key={shift.id} className="flex items-center justify-between py-3 border-b border-zinc-100 last:border-0">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-bold">Shift: {format(new Date(shift.startTime), 'MMM d')}</p>
                  <p className="text-xs text-zinc-400">{shift.durationMinutes} minutes @ ${HOURLY_RATE}/hr</p>
                </div>
              </div>
              <p className="font-black text-emerald-600">+${shift.amountOwed?.toFixed(2)}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card className="flex items-center gap-4">
      <div className="w-12 h-12 bg-zinc-900 text-white rounded-2xl flex items-center justify-center">
        {icon}
      </div>
      <div>
        <p className="text-xs font-bold text-zinc-400 uppercase">{label}</p>
        <p className="text-2xl font-black">{value}</p>
      </div>
    </Card>
  );
}

function AIView({ profile }: { profile: UserProfile }) {
  const [messages, setMessages] = useState<{ role: 'user' | 'model', text: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'chat' | 'maps' | 'image' | 'thinking'>('chat');
  const [aspectRatio, setAspectRatio] = useState<any>("1:1");
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [groundingLinks, setGroundingLinks] = useState<{ title: string, url: string }[]>([]);
  const [hasKey, setHasKey] = useState<boolean | null>(null);

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasKey(selected);
      } else {
        setHasKey(true); // Fallback for local dev
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasKey(true);
    }
  };

  const handleSend = async () => {
    if (!input.trim()) return;
    if (!hasKey) {
      handleSelectKey();
      return;
    }
    setLoading(true);
    const userMsg = { role: 'user' as const, text: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');

    try {
      let response = '';
      if (mode === 'chat') {
        response = await aiService.chatWithAssistant(input, messages);
      } else if (mode === 'thinking') {
        response = await aiService.complexReasoning(input);
      } else if (mode === 'maps') {
        const result = await aiService.findNearbyResources(input, profile?.location);
        response = result.text;
        setGroundingLinks(result.links);
      } else if (mode === 'image') {
        const img = await aiService.generateActivityImage(input, aspectRatio);
        if (img) {
          setGeneratedImage(img);
          response = "I've generated an activity image for you!";
        } else {
          response = "I couldn't generate the image. Please try a different prompt.";
        }
      }
      setMessages(prev => [...prev, { role: 'model', text: response }]);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'model', text: "Sorry, I encountered an error. Please try again." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-black tracking-tight">AI Assistant</h1>
          <p className="text-zinc-500">Powered by Gemini Intelligence</p>
        </div>
        <div className="flex bg-zinc-100 p-1 rounded-2xl">
          <button onClick={() => setMode('chat')} className={cn("px-4 py-2 rounded-xl text-xs font-bold transition-all", mode === 'chat' ? "bg-white shadow-sm" : "text-zinc-400")}>Chat</button>
          <button onClick={() => setMode('thinking')} className={cn("px-4 py-2 rounded-xl text-xs font-bold transition-all", mode === 'thinking' ? "bg-white shadow-sm" : "text-zinc-400")}>Think</button>
          <button onClick={() => setMode('maps')} className={cn("px-4 py-2 rounded-xl text-xs font-bold transition-all", mode === 'maps' ? "bg-white shadow-sm" : "text-zinc-400")}>Maps</button>
          <button onClick={() => setMode('image')} className={cn("px-4 py-2 rounded-xl text-xs font-bold transition-all", mode === 'image' ? "bg-white shadow-sm" : "text-zinc-400")}>Image</button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <Card className="h-[500px] flex flex-col p-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {hasKey === false ? (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4 p-6">
                  <Shield className="w-12 h-12 text-amber-500" />
                  <div className="space-y-2">
                    <p className="font-bold">Advanced AI Features Locked</p>
                    <p className="text-xs text-zinc-500">To use high-quality image generation and complex reasoning, you must select a paid Gemini API key.</p>
                  </div>
                  <Button onClick={handleSelectKey}>Select API Key</Button>
                  <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="text-[10px] text-zinc-400 underline">Learn about billing</a>
                </div>
              ) : messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-40">
                  <Sparkles className="w-12 h-12" />
                  <div>
                    <p className="font-bold">How can I help today?</p>
                    <p className="text-xs">Ask about care tips, schedules, or nearby parks.</p>
                  </div>
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} className={cn("flex flex-col", msg.role === 'user' ? "items-end" : "items-start")}>
                  <div className={cn(
                    "max-w-[85%] p-4 rounded-2xl shadow-sm",
                    msg.role === 'user' ? "bg-zinc-900 text-white rounded-tr-none" : "bg-zinc-100 text-zinc-900 rounded-tl-none"
                  )}>
                    <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex items-center gap-2 text-zinc-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-xs font-medium">Gemini is thinking...</span>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-zinc-100 flex gap-3">
              <input 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder={mode === 'image' ? "Describe the activity image..." : "Ask anything..."}
                className="flex-1 bg-zinc-100 border-0 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-zinc-900 outline-none"
              />
              <Button onClick={handleSend} disabled={loading} className="rounded-xl px-6">
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          {mode === 'image' && (
            <Card className="space-y-4">
              <h3 className="font-bold flex items-center gap-2">
                <ImageIcon className="w-4 h-4" />
                Image Settings
              </h3>
              <div className="grid grid-cols-3 gap-2">
                {["1:1", "3:4", "4:3", "9:16", "16:9", "21:9", "2:3", "3:2"].map(ratio => (
                  <button 
                    key={ratio}
                    onClick={() => setAspectRatio(ratio)}
                    className={cn("p-2 text-[10px] font-bold border rounded-lg transition-all", aspectRatio === ratio ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-200 text-zinc-500 hover:border-zinc-400")}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
              {generatedImage && (
                <div className="pt-4 space-y-2">
                  <p className="text-[10px] font-bold uppercase text-zinc-400">Latest Generation</p>
                  <img src={generatedImage} className="w-full rounded-xl border border-zinc-100 shadow-lg" />
                </div>
              )}
            </Card>
          )}

          {mode === 'maps' && groundingLinks.length > 0 && (
            <Card className="space-y-4">
              <h3 className="font-bold flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                Nearby Resources
              </h3>
              <div className="space-y-2">
                {groundingLinks.map((link, i) => (
                  <a 
                    key={i} 
                    href={link.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-3 bg-zinc-50 rounded-xl hover:bg-zinc-100 transition-all group"
                  >
                    <span className="text-sm font-medium">{link.title}</span>
                    <ChevronRight className="w-4 h-4 text-zinc-400 group-hover:text-zinc-900" />
                  </a>
                ))}
              </div>
            </Card>
          )}

          <Card className="bg-zinc-900 text-white border-0">
            <h3 className="font-bold mb-2 flex items-center gap-2">
              <Brain className="w-4 h-4 text-emerald-400" />
              AI Capabilities
            </h3>
            <ul className="text-xs space-y-2 text-zinc-400">
              <li className="flex gap-2">
                <span className="text-emerald-400">•</span>
                Complex reasoning for care plans
              </li>
              <li className="flex gap-2">
                <span className="text-emerald-400">•</span>
                Real-time Google Maps grounding
              </li>
              <li className="flex gap-2">
                <span className="text-emerald-400">•</span>
                High-quality image generation
              </li>
              <li className="flex gap-2">
                <span className="text-emerald-400">•</span>
                Context-aware chat history
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ProfileView({ profile }: { profile: UserProfile }) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [role, setRole] = useState(profile.role);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await updateDoc(doc(db, 'users', profile.uid), {
      displayName,
      role
    });
    setSaving(false);
    alert("Profile updated!");
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <header>
        <h2 className="text-3xl font-black">Your Profile</h2>
        <p className="text-zinc-500">Manage your personal information</p>
      </header>

      <Card className="space-y-6">
        <div className="flex items-center gap-6">
          <img src={profile.photoURL || `https://ui-avatars.com/api/?name=${displayName}`} className="w-24 h-24 rounded-3xl" />
          <Button variant="secondary">Change Photo</Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-zinc-400">Display Name</label>
            <input 
              type="text" 
              value={displayName} 
              onChange={e => setDisplayName(e.target.value)}
              className="w-full p-3 bg-zinc-50 rounded-xl border-0 focus:ring-2 focus:ring-black"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-zinc-400">Role</label>
            <select 
              value={role} 
              onChange={e => setRole(e.target.value as UserRole)}
              className="w-full p-3 bg-zinc-50 rounded-xl border-0 focus:ring-2 focus:ring-black"
            >
              <option value="parent">Parent</option>
              <option value="sitter">Sitter</option>
              <option value="admin">Admin</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
        </div>

        <div className="pt-4">
          <Button onClick={handleSave} disabled={saving} className="w-full h-14 text-lg">
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function VoiceRecorder({ onTranscription }: { onTranscription: (text: string) => void }) {
  const [isRecording, setIsRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Microphone access is not supported in this browser.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      mediaRecorder.current.ondataavailable = (e) => chunks.current.push(e.data);
      mediaRecorder.current.onstop = async () => {
        const blob = new Blob(chunks.current, { type: 'audio/webm' });
        chunks.current = [];
        setLoading(true);
        
        try {
          const reader = new FileReader();
          reader.readAsDataURL(blob);
          reader.onloadend = async () => {
            const base64 = (reader.result as string).split(',')[1];
            const transcription = await aiService.transcribeVoiceMemo(base64, 'audio/webm');
            onTranscription(transcription);
            setLoading(false);
          };
        } catch (err) {
          console.error("Transcription failed", err);
          setLoading(false);
          alert("Failed to transcribe audio. Please try again.");
        }
      };
      
      mediaRecorder.current.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Failed to start recording", err);
      alert("Could not access microphone. Please check permissions.");
    }
  };

  const stopRecording = () => {
    mediaRecorder.current?.stop();
    setIsRecording(false);
  };

  return (
    <button 
      type="button"
      onClick={isRecording ? stopRecording : startRecording}
      disabled={loading}
      className={cn(
        "p-3 rounded-xl transition-all",
        isRecording ? "bg-red-500 text-white animate-pulse" : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
      )}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
    </button>
  );
}
