import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, Zap, Sparkles, X, ChevronRight, Loader2, ArrowUpRight, Star, Heart, 
  TrendingUp, Clock, Wallet, Brain, MessageSquare, Plus, CheckCircle2, Cpu, Target, BookOpen, Users
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { LinkPreview } from './components/LinkPreview';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { NICHES, Niche, calculateDifficultyScore } from './data/niches';
import { getNicheActionPlan, generateNicheImage } from './lib/gemini';
import { auth, db, signInWithGoogle } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, Timestamp } from 'firebase/firestore';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function generateTrendData(niche: Niche) {
  const seed = niche.title.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const months = ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May'];
  const trendPoints: { month: string; interest: number }[] = [];
  
  const growthFactor = niche.potential === '$$$' ? 4.2 : niche.potential === '$$' ? 2.8 : 1.4;
  const initialValue = 40 + (seed % 15);
  
  for (let i = 0; i < 12; i++) {
    const noise = Math.sin(seed + (i * 1.5)) * 6 + Math.cos(seed * 0.3 + i) * 4;
    const growth = i * growthFactor;
    const val = Math.round(initialValue + growth + noise);
    trendPoints.push({
      month: months[i],
      interest: Math.min(100, Math.max(10, val))
    });
  }
  
  return trendPoints;
}

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
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface UserReview {
  id: string;
  nicheId: string;
  nicheName: string;
  experienceSummary: string;
  actionableSteps: string;
  monetaryOutcome: string;
  rating: number;
  userId: string;
  userEmail: string;
  createdAt: Timestamp;
}

export default function App() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [potentialFilter, setPotentialFilter] = useState<string>('All');
  const [costFilter, setCostFilter] = useState<string>('All');
  const [timeFilter, setTimeFilter] = useState<string>('All');
  const [selectedNiche, setSelectedNiche] = useState<Niche | null>(NICHES[0]);
  const [actionPlan, setActionPlan] = useState<string | null>(null);
  const [aiImage, setAiImage] = useState<string | null>(null);
  const [isLoadingPlan, setIsLoadingPlan] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  // Agent State
  const [isAgentOpen, setIsAgentOpen] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState("");
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [customNiches, setCustomNiches] = useState<Niche[]>([]);
  const [dailyNiches, setDailyNiches] = useState<Niche[]>([]);

  // Daily Discovery State
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [isUpskillOpen, setIsUpskillOpen] = useState(false);
  const [isGeneratingDaily, setIsGeneratingDaily] = useState(false);

  // Quiz State
  const [isQuizOpen, setIsQuizOpen] = useState(false);
  const [quizStep, setQuizStep] = useState(0);
  const [quizResults, setQuizResults] = useState<Niche[]>([]);
  const [quizData, setQuizData] = useState({
    budget: 5,
    skill: 5,
    time: 5,
    interests: [] as string[]
  });

  // Review State
  const [reviews, setReviews] = useState<UserReview[]>([]);
  const [isReviewFormOpen, setIsReviewFormOpen] = useState(false);
  const [reviewFormData, setReviewFormData] = useState({
    experience: '',
    steps: '',
    outcome: '',
    rating: 5
  });

  const [comparisonList, setComparisonList] = useState<Niche[]>([]);
  const [isComparing, setIsComparing] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<number>(-2); 

  // Onboarding check
  useEffect(() => {
    const seen = localStorage.getItem('niche_onboarding_v1');
    if (!seen) {
      setOnboardingStep(0);
    } else {
      setOnboardingStep(-1);
    }
  }, []);

  const finishOnboarding = () => {
    localStorage.setItem('niche_onboarding_v1', 'true');
    setOnboardingStep(-1);
  };

  const toggleCompare = (niche: Niche) => {
    setComparisonList(prev => {
      const exists = prev.find(n => n.id === niche.id);
      if (exists) return prev.filter(n => n.id !== niche.id);
      if (prev.length >= 3) return prev;
      return [...prev, niche];
    });
  };

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  // Fetch Daily Niches
  useEffect(() => {
    const q = query(collection(db, 'daily_niches'), orderBy('publishDate', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Niche & { publishDate: string }));
      setDailyNiches(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'daily_niches');
    });
    return () => unsubscribe();
  }, []);

  // Check and Generate Daily Niche
  useEffect(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const hasToday = dailyNiches.some(n => (n as any).publishDate === todayStr);
    
    // Only generate if we have established connection and user is signed in
    // This avoids race conditions on boot
    if (!hasToday && user && !isGeneratingDaily) {
        const generate = async () => {
            setIsGeneratingDaily(true);
            try {
                const result = await import('./lib/gemini').then(m => m.generateDailyNicheDiscovery());
                const newNode = {
                    ...result,
                    publishDate: todayStr,
                };
                await addDoc(collection(db, 'daily_niches'), newNode);
            } catch (err) {
                console.error("Daily gen failed", err);
            } finally {
                setIsGeneratingDaily(false);
            }
        };
        generate();
    }
  }, [dailyNiches, user, isGeneratingDaily]);

  useEffect(() => {
    if (selectedNiche) {
      const q = query(
        collection(db, 'reviews'),
        where('nicheId', '==', selectedNiche.id),
        orderBy('createdAt', 'desc')
      );

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const revs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserReview));
        setReviews(revs);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'reviews');
      });

      return () => unsubscribe();
    }
  }, [selectedNiche]);

  const filteredNiches = useMemo(() => {
    const allNiches = [...customNiches, ...dailyNiches, ...NICHES];
    return allNiches.filter(niche => {
      const matchesSearch = niche.title.toLowerCase().includes(search.toLowerCase()) || 
                           niche.shortDescription.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = category === 'All' || niche.category === category;
      const matchesPotential = potentialFilter === 'All' || niche.potential === potentialFilter;
      
      const getInBand = (val: number) => {
        if (val <= 3) return 'Low';
        if (val <= 7) return 'Medium';
        return 'High';
      };

      const matchesCost = costFilter === 'All' || getInBand(niche.startupCost) === costFilter;
      const matchesTime = timeFilter === 'All' || getInBand(niche.timeCommitment) === timeFilter;

      return matchesSearch && matchesCategory && matchesPotential && matchesCost && matchesTime;
    });
  }, [search, category, potentialFilter, costFilter, timeFilter, customNiches]);

  const categories = ['All', 'Digital', 'Service', 'Local', 'Creative', 'Tech'];

  const trendData = useMemo(() => {
    return selectedNiche ? generateTrendData(selectedNiche) : [];
  }, [selectedNiche]);

  const { minTrend, maxTrend, growthPercentage } = useMemo(() => {
    if (!trendData.length) return { minTrend: 0, maxTrend: 100, growthPercentage: 0 };
    const minVal = Math.min(...trendData.map(d => d.interest));
    const maxVal = Math.max(...trendData.map(d => d.interest));
    const first = trendData[0].interest;
    const last = trendData[trendData.length - 1].interest;
    const percent = Math.round(((last - first) / first) * 100);
    return { minTrend: minVal, maxTrend: maxVal, growthPercentage: percent };
  }, [trendData]);

  const [activeNicheId, setActiveNicheId] = useState<string | null>(null);

  const handleNicheClick = async (niche: Niche) => {
    setSelectedNiche(niche);
    setActiveNicheId(niche.id);
    setIsLoadingPlan(true);
    setIsGeneratingImage(true);
    setActionPlan(null);
    setAiImage(null);
    
    // Store current ID to prevent race conditions
    const currentId = niche.id;

    // Fire off both requests
    const planPromise = getNicheActionPlan(niche.title, niche.shortDescription);
    const imagePromise = generateNicheImage(niche.title);

    try {
      const plan = await planPromise;
      // Only update if we are still on the same niche
      if (currentId === niche.id) {
        setActionPlan(plan);
      }
    } catch (err) {
      if (currentId === niche.id) {
        setActionPlan("Failed to load strategic advice. Server node connection unstable.");
      }
    } finally {
      if (currentId === niche.id) {
        setIsLoadingPlan(false);
      }
    }

    try {
      const img = await imagePromise;
      if (currentId === niche.id) {
        setAiImage(img);
      }
    } catch (err) {
      console.warn("Visual generation failed for node:", niche.id);
    } finally {
      if (currentId === niche.id) {
        setIsGeneratingImage(false);
      }
    }
  };

  const handleQuizSubmit = () => {
    const allNiches = [...customNiches, ...dailyNiches, ...NICHES];
    const recommended = allNiches.filter(niche => {
      const budgetOk = niche.startupCost <= (quizData.budget + 2);
      const skillOk = niche.skillRequired <= (quizData.skill + 2);
      const timeOk = niche.timeCommitment <= (quizData.time + 2);
      const interestOk = quizData.interests.length === 0 || quizData.interests.includes(niche.category);
      return budgetOk && skillOk && timeOk && interestOk;
    })
    .sort((a, b) => parseFloat(calculateDifficultyScore(a)) - parseFloat(calculateDifficultyScore(b)))
    .slice(0, 5);

    setQuizResults(recommended);
    setQuizStep(4);
  };

  const handleReviewSubmit = async () => {
    if (!user || !selectedNiche) return;
    try {
      await addDoc(collection(db, 'reviews'), {
        nicheId: selectedNiche.id,
        nicheName: selectedNiche.title,
        experienceSummary: reviewFormData.experience,
        actionableSteps: reviewFormData.steps,
        monetaryOutcome: reviewFormData.outcome,
        rating: reviewFormData.rating,
        userId: user.uid,
        userEmail: user.email,
        createdAt: serverTimestamp()
      });
      setIsReviewFormOpen(false);
      setReviewFormData({ experience: '', steps: '', outcome: '', rating: 5 });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'reviews');
    }
  };

  const handleSynthesizeNiche = async () => {
    if (!agentPrompt.trim()) return;
    setIsSynthesizing(true);
    setAgentError(null);
    try {
      const result = await import('./lib/gemini').then(m => m.generateCustomNiche(agentPrompt));
      const newNode: Niche = {
        id: `custom-${Date.now()}`,
        title: result.title || "Custom Opportunity",
        category: (result.category as any) || "Digital",
        difficulty: (result.difficulty as any) || "Beginner",
        shortDescription: result.shortDescription || "Generated by Synthesis Agent",
        potential: (result.potential as any) || "$$",
        startupCost: result.startupCost ?? 0,
        timeCommitment: result.timeCommitment ?? 5,
        marketSaturation: result.marketSaturation ?? 3,
        skillRequired: result.skillRequired ?? 5,
      };
      
      setCustomNiches(prev => [newNode, ...prev]);
      setSelectedNiche(newNode);
      setActiveNicheId(newNode.id);
      setIsAgentOpen(false);
      setAgentPrompt("");
      handleNicheClick(newNode);
    } catch (err: any) {
      console.error(err);
      setAgentError(err.message || "Synthesis failed. Please verify your connection and try again.");
    } finally {
      setIsSynthesizing(false);
    }
  };

  // Load initial plan for the first niche
  useEffect(() => {
    if (selectedNiche && !actionPlan) {
      handleNicheClick(selectedNiche);
    }
  }, []);

  const handleExportCSV = () => {
    const headers = ['ID', 'Title', 'Category', 'Difficulty', 'Potential', 'Startup Cost', 'Skill Required'];
    const csvContent = [
      headers.join(','),
      ...NICHES.map(n => [
        n.id,
        `"${n.title}"`,
        n.category,
        n.difficulty,
        n.potential,
        n.startupCost,
        n.skillRequired
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NZ_Niche_Database_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  const handleExportStrategy = () => {
    if (!selectedNiche || !actionPlan) return;
    const content = `STRATEGIC BLUEPRINT: ${selectedNiche.title}\n\n${actionPlan}\n\nGenerated by NicheSource.NZ`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Strategy_${selectedNiche.title.replace(/\s+/g, '_')}.txt`;
    a.click();
  };

  return (
    <div className="h-screen h-[100dvh] w-full flex flex-col bg-surface text-ink font-sans border-2 md:border-[8px] border-ink selection:bg-active selection:text-surface relative overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b-4 border-ink bg-white h-[80px] relative z-40">
        <motion.div 
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="flex items-baseline gap-4"
        >
          <h1 
            className="text-4xl font-black uppercase tracking-tighter cursor-pointer hover:scale-105 transition-transform border-b-6 border-pop-pink leading-none italic bg-pop-yellow px-2" 
            onClick={() => window.location.reload()}
          >
            NICHE.NZ
          </h1>
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[9px] font-black uppercase opacity-60 leading-none">DATABASE_ENTRIES: {NICHES.length}</span>
            <span className="text-[7px] font-mono text-active leading-none animate-pulse italic font-black">SYNC_LIVE // PRO_DATA_GRID</span>
          </div>
        </motion.div>
        
        <div className="flex items-center gap-4">
          <motion.button 
            whileHover={{ scale: 1.05 }}
            onClick={() => setIsUpskillOpen(true)}
            className="hidden lg:flex items-center gap-2 bg-white text-ink px-6 py-3 text-[11px] font-black uppercase tracking-widest border-4 border-ink shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none translate-y-[-2px] hover:bg-neutral-50"
          >
            <BookOpen className="w-4 h-4 text-active" />
            Upskill_Now
          </motion.button>

          <motion.button 
            whileHover={{ scale: 1.05 }}
            onClick={() => { setIsQuizOpen(true); setQuizStep(0); }}
            className="hidden lg:flex items-center gap-2 bg-pop-cyan text-surface px-6 py-3 text-[11px] font-black uppercase tracking-widest border-4 border-ink shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none translate-y-[-2px]"
          >
            <Sparkles className="w-4 h-4 text-surface" />
            Niche_Analysis
          </motion.button>

          <motion.button 
            whileHover={{ scale: 1.05 }}
            onClick={() => setIsAgentOpen(true)}
            className="hidden lg:flex items-center gap-2 bg-pop-pink text-surface px-6 py-3 text-[11px] font-black uppercase tracking-widest border-4 border-ink shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none translate-y-[-2px]"
          >
            <Cpu className="w-4 h-4 text-surface" />
            Synthesis_Lab
          </motion.button>
          
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="relative group hidden md:block"
          >
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 opacity-30 group-focus-within:opacity-100" />
            <input
              type="text"
              placeholder="SEARCH_INDEX..."
              className="bg-transparent border border-ink/20 rounded-none py-1.5 pl-9 pr-3 focus:outline-none focus:border-ink transition-all text-[10px] font-mono tracking-widest w-48"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </motion.div>

          <nav className="hidden lg:flex gap-6 text-[10px] font-black uppercase tracking-widest">
            {['History', 'Market Analysis', 'Export CSV'].map((link, i) => (
              <motion.span 
                key={link}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 + (i * 0.1) }}
                className="cursor-pointer hover:text-active transition-colors relative group"
                onClick={link === 'Export CSV' ? handleExportCSV : link === 'History' ? () => setIsArchiveOpen(true) : () => { setIsQuizOpen(true); setQuizStep(0); }}
              >
                {link === 'History' && <span className="absolute -top-1 -right-2 w-1.5 h-1.5 bg-active rounded-full" />}
                {link}
                <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-active transition-all group-hover:w-full" />
              </motion.span>
            ))}
            <motion.span 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="text-active flex items-center gap-1.5"
            >
              <span className="w-2 h-2 rounded-full bg-active animate-pulse" /> Live Alpha
            </motion.span>
          </nav>

          {!user ? (
            <motion.div 
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="flex items-center gap-3"
            >
              <span className="hidden sm:block text-[8px] font-mono opacity-50 uppercase text-right leading-tight italic">Terminal_ID<br/>Required</span>
              <button 
                onClick={signInWithGoogle} 
                className="text-[10px] font-black uppercase tracking-widest border-2 border-active text-active px-4 py-1.5 hover:bg-active hover:text-surface transition-all shadow-[4px_4px_0px_0px_#141414] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]"
              >
                AUTH_LOGIN
              </button>
            </motion.div>
          ) : (
            <motion.div 
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              className="flex items-center gap-4 bg-ink text-surface px-4 py-1.5 border border-surface/20 shadow-[6px_6px_0px_0px_#DC2626]"
            >
              <div className="flex flex-col items-end">
                <span className="text-[9px] font-black uppercase tracking-tight leading-none">{user.displayName || user.email?.split('@')[0]}</span>
                <span className="text-[7px] font-mono opacity-50 uppercase tracking-widest mt-0.5 font-bold">CONTRIBUTOR_NODE_ACTIVE</span>
              </div>
              <button onClick={() => auth.signOut()} className="text-[9px] font-black opacity-30 hover:opacity-100 uppercase border-l border-surface/20 pl-4">EXIT</button>
            </motion.div>
          )}
        </div>
      </header>

      {/* Category Bar */}
      <div className="bg-ink text-surface flex overflow-x-auto scrollbar-hide border-b-4 border-ink relative z-30">
        {categories.map((cat, i) => (
          <motion.button
            key={cat}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: i * 0.05 }}
            onClick={() => setCategory(cat)}
            className={cn(
              "px-8 py-5 text-[11px] font-black uppercase tracking-[0.2em] transition-all relative group",
              category === cat ? "text-pop-yellow" : "opacity-60 hover:opacity-100 hover:bg-white/10"
            )}
          >
            <span className="relative z-10 italic">{cat}</span>
            {category === cat ? (
              <motion.div 
                layoutId="active-cat-bg"
                className="absolute inset-0 bg-pop-cyan z-0"
                initial={false}
              />
            ) : (
              <div className="absolute bottom-0 left-0 w-0 h-1 bg-pop-pink transition-all group-hover:w-full" />
            )}
          </motion.button>
        ))}
      </div>

      {/* Refinement Bar */}
      <motion.div 
        initial={{ y: -10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="bg-header flex flex-wrap items-center gap-y-2 px-6 py-2 border-b-2 border-ink relative z-20"
      >
        <div className="flex items-center gap-3 border-r border-ink/20 pr-6 mr-6">
          <span className="text-[8px] font-black uppercase opacity-40 whitespace-nowrap tracking-widest">Potential:</span>
          {['All', '$', '$$', '$$$'].map((p) => (
            <button
              key={p}
              onClick={() => setPotentialFilter(p)}
              className={cn(
                "text-[9px] font-black uppercase px-2 py-0.5 border border-ink/20 transition-all",
                potentialFilter === p ? "bg-ink text-surface border-ink" : "hover:border-ink"
              )}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 border-r border-ink/20 pr-6 mr-6">
          <span className="text-[8px] font-black uppercase opacity-40 whitespace-nowrap tracking-widest">Startup Cost:</span>
          {['All', 'Low', 'Medium', 'High'].map((c) => (
            <button
              key={c}
              onClick={() => setCostFilter(c)}
              className={cn(
                "text-[9px] font-black uppercase px-2 py-0.5 border border-ink/20 transition-all",
                costFilter === c ? "bg-ink text-surface border-ink" : "hover:border-ink"
              )}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[8px] font-black uppercase opacity-40 whitespace-nowrap tracking-widest">Time commitment:</span>
          {['All', 'Low', 'Medium', 'High'].map((t) => (
            <button
              key={t}
              onClick={() => setTimeFilter(t)}
              className={cn(
                "text-[9px] font-black uppercase px-2 py-0.5 border border-ink/20 transition-all",
                timeFilter === t ? "bg-ink text-surface border-ink" : "hover:border-ink"
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {(category !== 'All' || potentialFilter !== 'All' || costFilter !== 'All' || timeFilter !== 'All' || search !== '') && (
          <button 
            onClick={() => {
              setCategory('All');
              setPotentialFilter('All');
              setCostFilter('All');
              setTimeFilter('All');
              setSearch('');
            }}
            className="ml-auto text-[8px] font-black uppercase underline opacity-40 hover:opacity-100"
          >
            Clear_All_Filters
          </button>
        )}
      </motion.div>

      <main className="flex-1 flex overflow-hidden">
        {/* List Section */}
        <section className="w-full lg:w-2/3 border-r-4 border-ink flex flex-col overflow-hidden bg-white">
          {/* List Header */}
          <div className="grid grid-cols-12 bg-white text-ink text-[10px] font-black uppercase py-4 px-6 gap-4 italic tracking-widest border-b-4 border-ink">
            <div className="col-span-1">ID</div>
            <div className="col-span-6 lg:col-span-5">Opportunity_Title</div>
            <div className="col-span-2 text-center">Score</div>
            <div className="hidden lg:block col-span-2 text-center">Category</div>
            <div className="col-span-1 text-right">$$$</div>
          </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar font-mono text-[11px]">
              <motion.div 
                initial="hidden"
                animate="visible"
                variants={{
                  visible: { transition: { staggerChildren: 0.03 } }
                }}
              >
                {filteredNiches.map((niche) => (
                  <motion.div
                    key={niche.id}
                    variants={{
                      hidden: { x: -20, opacity: 0 },
                      visible: { x: 0, opacity: 1 }
                    }}
                    onClick={() => handleNicheClick(niche)}
                    className={cn(
                      "grid grid-cols-12 items-center px-6 py-6 border-b-4 border-ink cursor-pointer transition-all duration-300 relative overflow-hidden group",
                      selectedNiche?.id === niche.id 
                        ? "bg-pop-cyan text-surface" 
                        : "hover:bg-pop-yellow odd:bg-white"
                    )}
                  >
                    {/* Active Indicator Bar */}
                    <AnimatePresence>
                      {selectedNiche?.id === niche.id && (
                        <motion.div 
                          layoutId="active-indicator"
                          className="absolute left-0 top-0 bottom-0 w-3 bg-pop-pink"
                          initial={{ height: 0 }}
                          animate={{ height: "100%" }}
                        />
                      )}
                    </AnimatePresence>

                    <div className="col-span-1 font-black tracking-tighter flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCompare(niche);
                        }}
                        className={cn(
                          "w-6 h-6 border-4 border-ink flex items-center justify-center transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]",
                          comparisonList.find(n => n.id === niche.id) ? "bg-pop-pink border-ink text-surface" : "bg-white hover:bg-pop-pink/20"
                        )}
                      >
                        {comparisonList.find(n => n.id === niche.id) && <motion.div layoutId={`check-${niche.id}`} className="w-3 h-3 bg-white" />}
                      </button>
                      <span className="opacity-40">{niche.id.startsWith('custom') ? 'USR' : (niche as any).publishDate ? 'DLY' : niche.id.padStart(3, '0')}</span>
                    </div>
                    <div className="col-span-6 lg:col-span-5 font-black uppercase truncate pr-4 italic tracking-tighter group-hover:translate-x-2 transition-transform flex items-center gap-2 text-lg">
                      {niche.title}
                      {(niche as any).publishDate === new Date().toISOString().split('T')[0] && (
                        <span className="text-[8px] bg-active text-white px-2 py-1 rotate-3 font-black">NEW_RECORD</span>
                      )}
                    </div>
                    <div className="col-span-2 text-center text-sm font-black">
                       <span className={cn("px-2 py-1 border-2 border-ink", selectedNiche?.id === niche.id ? "bg-active text-white" : "bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]")}>
                        {calculateDifficultyScore(niche)}
                       </span>
                    </div>
                    <div className="hidden lg:block col-span-2 text-center uppercase text-[10px] font-black italic opacity-60">
                       {niche.category}
                    </div>
                    <div className="col-span-1 text-right font-black text-2xl tracking-tighter group-hover:scale-125 transition-transform text-outline-ink">
                      {niche.potential}
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            </div>
        </section>

        {/* Sidebar Info */}
        <aside className="hidden lg:flex w-1/3 bg-header p-8 flex-col gap-8 overflow-y-auto custom-scrollbar border-l-4 border-ink relative z-0">
          <AnimatePresence mode="wait">
            <motion.div 
              key={selectedNiche?.id || 'empty'}
              initial={{ x: 30, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -30, opacity: 0 }}
              className="flex flex-col gap-8"
            >
              <div className="flex flex-col gap-3">
                <div className="relative group overflow-hidden border-4 border-ink shadow-[12px_12px_0px_0px_#000000] mb-6 bg-white aspect-video flex items-center justify-center">
                  {isGeneratingImage ? (
                    <div className="flex flex-col items-center gap-3">
                      <motion.div 
                        animate={{ rotate: 360, scale: [1, 1.2, 1] }}
                        transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                        className="w-12 h-12 border-8 border-pop-pink border-t-transparent rounded-full" 
                      />
                      <span className="text-[10px] font-black uppercase tracking-widest opacity-60 animate-bounce text-ink">Neural_POP_Synthesis...</span>
                    </div>
                  ) : aiImage ? (
                    <motion.img 
                      initial={{ scale: 1.1, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      src={aiImage}
                      alt={selectedNiche?.title}
                      className="w-full h-full object-cover contrast-125 hover:brightness-110 transition-all duration-700"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <img 
                      src={`https://images.unsplash.com/photo-${
                        selectedNiche?.category === 'Tech' ? '1518770660439-4636190af475' :
                        selectedNiche?.category === 'Digital' ? '1498050108023-c5249f4df085' :
                        selectedNiche?.category === 'Creative' ? '1453928582365-b6ad33cbcf64' :
                        selectedNiche?.category === 'Local' ? '1556910103-1c02745aae4d' :
                        '1521791136064-7986c2959213' // Service
                      }?auto=format&fit=crop&q=80&w=800`}
                      alt={selectedNiche?.title}
                      className="w-full h-full object-cover grayscale brightness-90 contrast-200 group-hover:grayscale-0 group-hover:brightness-100 transition-all duration-500 opacity-80"
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <div className="absolute inset-0 bg-pop-yellow/10 group-hover:bg-transparent transition-colors pointer-events-none" />
                  <div className="absolute bottom-4 left-4 bg-ink text-surface text-[10px] font-black uppercase px-3 py-1 tracking-[0.2em] pointer-events-none italic">
                    {aiImage ? 'ALPHA_SYNC_IMAGE' : 'LO-FI_REPRESENTATION'}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <motion.span 
                    animate={{ scale: [1, 1.5, 1] }} 
                    transition={{ repeat: Infinity, duration: 1 }}
                    className="w-3 h-3 bg-pop-pink rounded-full border-2 border-ink" 
                  />
                  <span className="font-mono text-[10px] font-black uppercase opacity-60 tracking-widest text-ink">Active_Strategy // NZ_REGION</span>
                </div>
                <h2 className="text-5xl font-black uppercase italic leading-none text-ink pr-8 break-words [text-shadow:2px_2px_0px_rgba(0,0,0,0.1)]">{selectedNiche?.title}</h2>
                <div className="flex gap-2 mt-2">
                  <span className="px-3 py-1 bg-white border-4 border-ink text-[11px] font-black uppercase italic shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">{selectedNiche?.category}</span>
                  <span className="px-3 py-1 bg-active text-white border-4 border-ink text-[11px] font-black uppercase italic shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">Diff: {calculateDifficultyScore(selectedNiche!)}</span>
                </div>
                <p className="font-mono text-xs font-black uppercase leading-relaxed text-ink mt-4 bg-white/40 p-4 border-l-8 border-ink">{selectedNiche?.shortDescription}</p>
              </div>

              {/* Metrics Bar */}
              <div className="grid grid-cols-2 gap-6">
                 <div className="p-4 border-4 border-ink bg-white flex flex-col gap-2 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                    <span className="text-[9px] font-black uppercase tracking-widest text-ink/60">Startup_Cost</span>
                    <div className="flex gap-1 h-3">
                      {[...Array(10)].map((_, i) => (
                        <div key={i} className={cn("flex-1 border border-ink", i < selectedNiche!.startupCost ? "bg-pop-pink" : "bg-ink/5")} />
                      ))}
                    </div>
                 </div>
                 <div className="p-4 border-4 border-ink bg-white flex flex-col gap-2 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                    <span className="text-[9px] font-black uppercase tracking-widest text-ink/60">Skill_Level</span>
                    <div className="flex gap-1 h-3">
                      {[...Array(10)].map((_, i) => (
                        <div key={i} className={cn("flex-1 border border-ink", i < selectedNiche!.skillRequired ? "bg-pop-yellow" : "bg-ink/5")} />
                      ))}
                    </div>
                 </div>
              </div>

              <div className="flex flex-col gap-8">
                {/* Market Trend Card */}
                <div className="p-6 border-4 border-ink bg-white shadow-[6px_6px_0px_0px_rgba(3,54,255,1)] flex flex-col gap-4">
                  <div className="flex justify-between items-start border-b-2 border-ink pb-2">
                    <div className="flex flex-col">
                      <span className="text-[9px] font-black uppercase tracking-widest text-ink/60">NZ Market Momentum // 12-Month Search Index</span>
                      <h3 className="text-md font-black uppercase italic tracking-tighter">Market_Trend_Curve</h3>
                    </div>
                    <span className="text-[9px] font-black bg-pop-pink text-white px-2 py-0.5 border-2 border-ink uppercase tracking-wider whitespace-nowrap">
                      +{growthPercentage}% YoY Growth
                    </span>
                  </div>
                  
                  <div className="w-full h-36 font-mono text-[9px] pt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendData} margin={{ top: 5, right: 10, left: -25, bottom: 5 }}>
                        <XAxis 
                          dataKey="month" 
                          tick={{ fill: '#1A1A1B', fontWeight: 'bold', fontSize: 8 }}
                          tickLine={{ stroke: '#1A1A1B', strokeWidth: 1.5 }}
                          axisLine={{ stroke: '#1A1A1B', strokeWidth: 1.5 }}
                        />
                        <YAxis 
                          domain={[0, 100]}
                          tick={{ fill: '#1A1A1B', fontWeight: 'bold', fontSize: 8 }}
                          tickLine={{ stroke: '#1A1A1B', strokeWidth: 1.5 }}
                          axisLine={{ stroke: '#1A1A1B', strokeWidth: 1.5 }}
                        />
                        <Tooltip 
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              return (
                                <div className="bg-white border-2 border-ink p-2 font-mono text-[8px] shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] uppercase">
                                  <p className="font-black border-b border-ink/20 pb-0.5">{payload[0].payload.month}</p>
                                  <p className="text-active font-black mt-0.5">Index: {payload[0].value}</p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="interest" 
                          stroke="#0056B3" 
                          strokeWidth={3.5}
                          dot={{ r: 3, stroke: '#1A1A1B', strokeWidth: 1.5, fill: '#FFFFFF' }}
                          activeDot={{ r: 5, stroke: '#1A1A1B', strokeWidth: 2, fill: '#D90429' }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  
                  <div className="flex justify-between items-center text-[8px] font-mono text-ink/60 select-none uppercase">
                    <span>Index Min: {minTrend}</span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 bg-[#0056B3] border border-ink inline-block" /> EST_MOMENTUM
                    </span>
                    <span>Index Max: {maxTrend}</span>
                  </div>
                </div>
                <div className="p-8 border-8 border-ink bg-white shadow-[16px_16px_0px_0px_#FF0266]">
                  <h3 className="text-xl font-black uppercase tracking-tighter mb-6 border-b-6 border-ink pb-2 flex justify-between items-center italic">
                    Action_Blueprint
                    <Zap className="w-6 h-6 text-pop-yellow fill-pop-yellow stroke-ink stroke-[3]" />
                  </h3>

                  {isLoadingPlan ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-3 opacity-40 animate-pulse">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span className="text-[8px] font-mono uppercase tracking-[0.4em]">Decoding_Neural_Pathways...</span>
                    </div>
                  ) : (
                    <motion.div 
                      key={actionPlan}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex flex-col gap-6"
                    >
                      <div className="bg-active/5 border-l-4 border-active p-4 mb-2">
                        <h4 className="text-[9px] font-black uppercase text-active mb-1 flex items-center gap-2">
                          <ArrowUpRight className="w-3 h-3" /> Critical_Entry_Step
                        </h4>
                        <p className="text-[10px] font-mono opacity-70 italic">Scroll down in the blueprint below for specific sign-up links and zero-cost instructions.</p>
                      </div>
                      <div className="markdown-body">
                        <ReactMarkdown 
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: ({ node, ...props }) => {
                              return <LinkPreview url={props.href || ''} />;
                            },
                            table: ({ node, ...props }) => (
                              <div className="my-6 overflow-x-auto border-2 border-ink shadow-[4px_4px_0px_0px_rgba(0,0,0,0.1)]">
                                <table className="w-full text-left font-mono text-[9px]" {...props} />
                              </div>
                            ),
                            th: ({ node, ...props }) => (
                              <th className="bg-ink text-surface p-2 uppercase font-black tracking-widest border-r border-surface/10 last:border-0" {...props} />
                            ),
                            td: ({ node, ...props }) => (
                              <td className="p-2 border-r border-ink/10 last:border-0 bg-white/50" {...props} />
                            ),
                            h1: ({node, ...props}) => <h1 className="text-xl font-black uppercase italic border-b-2 border-ink pb-2 mb-4 mt-8 first:mt-0" {...props} />,
                            h2: ({node, ...props}) => <h2 className="text-lg font-black uppercase italic border-b border-ink/20 pb-1 mb-3 mt-6" {...props} />,
                            h3: ({node, ...props}) => <h3 className="text-sm font-black uppercase mb-2 mt-4 text-active" {...props} />,
                            ul: ({node, ...props}) => <ul className="list-none space-y-2 mb-4" {...props} />,
                            li: ({node, ...props}) => (
                              <li className="flex items-start gap-2 before:content-['//'] before:text-active before:font-bold before:text-[10px]" {...props} />
                            ),
                          }}
                        >
                          {actionPlan || ""}
                        </ReactMarkdown>
                      </div>
                    </motion.div>
                  )}

                  <motion.button 
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleExportStrategy}
                    className="w-full mt-6 py-4 bg-ink text-surface font-black uppercase text-[10px] tracking-[0.4em] hover:bg-neutral-800 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed group shadow-[4px_4px_0px_0px_#DC2626] hover:shadow-none hover:translate-x-1 hover:translate-y-1"
                    disabled={!actionPlan}
                  >
                    Export_Strategy_Document
                    <ArrowUpRight className="w-4 h-4 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                  </motion.button>
                </div>

                {/* Success Stories Section */}
                <div className="flex flex-col gap-4">
                   <div className="flex items-center justify-between">
                      <h3 className="text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-2">
                        <MessageSquare className="w-3 h-3" /> Success_Stories
                      </h3>
                      <button 
                        onClick={() => {
                            if (!user) { signInWithGoogle(); return; }
                            setIsReviewFormOpen(true);
                        }}
                        className="p-1.5 border border-ink hover:bg-ink hover:text-surface transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:shadow-none translate-x-[-2px] translate-y-[-2px] active:translate-x-0 active:translate-y-0"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                   </div>

                   <div className="space-y-4">
                      {reviews.length === 0 ? (
                        <p className="text-[10px] font-mono italic opacity-40">No localized reports captured yet. Be the first.</p>
                      ) : (
                        reviews.map((review, i) => (
                          <motion.div 
                            initial={{ x: 20, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            transition={{ delay: i * 0.1 }}
                            key={review.id} 
                            className="p-4 border border-ink bg-white/40 flex flex-col gap-2 hover:bg-white transition-colors cursor-default"
                          >
                            <div className="flex justify-between items-center">
                              <div className="flex gap-0.5">
                                {[...Array(5)].map((_, i) => (
                                  <Star key={i} className={cn("w-2.5 h-2.5", i < review.rating ? "fill-ink text-ink" : "text-ink/10")} />
                                ))}
                              </div>
                              <span className="text-[8px] font-mono opacity-50 uppercase">{review.userEmail?.split('@')[0]}</span>
                            </div>
                            <p className="text-[10px] font-mono italic leading-tight">"{review.experienceSummary}"</p>
                            <div className="flex justify-between items-end mt-1">
                               <span className="text-[8px] font-black text-active uppercase">Outcome: {review.monetaryOutcome}</span>
                               <span className="text-[7px] opacity-20 font-mono tracking-tighter">{review.createdAt?.toDate?.()?.toLocaleDateString() || 'Recent'}</span>
                            </div>
                          </motion.div>
                        ))
                      )}
                   </div>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </aside>
      </main>

      {/* Global Footer */}
      <footer className="h-8 hidden lg:flex items-center px-4 bg-ink text-surface font-mono text-[9px] uppercase justify-between tracking-[0.2em] border-t border-surface/10">
        <div className="flex gap-8">
          <span>© 2026 NicheSource.NZ // VER_4.0_STABLE</span>
          <span className="opacity-40">Network Status: ONLINE</span>
        </div>
        <div className="flex gap-4 items-center">
          <span className="text-active flex items-center gap-2 h-full uppercase"><span className="w-1.5 h-1.5 rounded-full bg-active animate-pulse" /> Encrypted Node</span>
          <span className="opacity-20">|</span>
          <span className="opacity-50">Local Time: {new Date().toLocaleTimeString()}</span>
        </div>
      </footer>

      {/* MODALS */}
      
      {/* Review Form Modal */}
      <AnimatePresence>
        {isReviewFormOpen && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-active/20 backdrop-blur-md"
            style={{ backgroundImage: 'radial-gradient(rgba(0,0,0,0.2) 1px, transparent 1px)', backgroundSize: '10px 10px' }}
          >
            <motion.div 
              initial={{ scale: 0.9, rotate: -1 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0.9, rotate: 1 }}
              className="bg-white border-8 border-ink w-full max-w-lg p-10 flex flex-col gap-8 shadow-[24px_24px_0px_0px_rgba(0,0,0,1)] relative"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-between items-start border-b-6 border-ink pb-6">
                <h2 className="text-4xl font-black uppercase italic tracking-tighter [text-shadow:2px_2px_0px_rgba(0,0,0,0.1)]">Performance Audit</h2>
                <button onClick={() => setIsReviewFormOpen(false)} className="bg-active p-1 border-4 border-ink shadow-[4px_4px_0px_0px_#000] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all">
                  <X className="w-8 h-8 text-white" />
                </button>
              </div>

              <div className="flex flex-col gap-6 font-black uppercase text-xs italic">
                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] font-black opacity-60">Rating_Weight</label>
                    <div className="flex gap-3">
                       {[1,2,3,4,5].map(v => (
                         <button 
                           key={v} 
                           onClick={() => setReviewFormData({ ...reviewFormData, rating: v })}
                           className={cn("w-12 h-12 border-4 border-ink flex items-center justify-center transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-y-1", reviewFormData.rating === v ? "bg-pop-yellow text-ink scale-110" : "bg-white hover:bg-pop-yellow/20")}
                         >
                           {v}
                         </button>
                       ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] font-black opacity-60">Experience_Vector</label>
                    <textarea 
                      className="bg-white border-4 border-ink p-4 outline-none focus:bg-pop-yellow/10 transition-all h-28 italic font-black"
                      value={reviewFormData.experience}
                      onChange={e => setReviewFormData({...reviewFormData, experience: e.target.value})}
                      placeholder="HOW WAS THE ENTRY PHASE?"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] font-black opacity-60">Actionable_Steps_Taken</label>
                    <input 
                      className="bg-white border-4 border-ink p-4 outline-none focus:bg-pop-yellow/10 transition-all italic font-black"
                      value={reviewFormData.steps}
                      onChange={e => setReviewFormData({...reviewFormData, steps: e.target.value})}
                      placeholder="STEP 1, STEP 2..."
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] font-black opacity-60">Monetary_Outcome_Report</label>
                    <input 
                      className="bg-white border-4 border-ink p-4 outline-none focus:bg-pop-yellow/10 transition-all italic font-black"
                      value={reviewFormData.outcome}
                      onChange={e => setReviewFormData({...reviewFormData, outcome: e.target.value})}
                      placeholder="E.G. $2K FIRST MONTH"
                    />
                  </div>
              </div>

              <button 
                onClick={handleReviewSubmit}
                className="w-full py-6 bg-active text-white font-black uppercase text-lg tracking-[0.2em] border-4 border-ink shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[-4px] active:translate-y-4 active:shadow-none transition-all italic disabled:opacity-50"
                disabled={!reviewFormData.experience || !reviewFormData.outcome}
              >
                LOG_PERFORMANCE
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Upskill Modal */}
      <AnimatePresence>
        {isUpskillOpen && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-ink/80 backdrop-blur-sm"
            style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.1) 1px, transparent 1px)', backgroundSize: '10px 10px' }}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white border-8 border-ink w-full max-w-2xl p-12 flex flex-col gap-8 shadow-[24px_24px_0px_0px_var(--color-active)]"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-between items-start border-b-6 border-ink pb-6">
                <div className="flex flex-col">
                  <span className="text-[10px] font-black uppercase text-active tracking-widest">Educational_Matrix // v1.0</span>
                  <h2 className="text-4xl font-black uppercase italic tracking-tighter">Skill_Synthesis</h2>
                </div>
                <button onClick={() => setIsUpskillOpen(false)} className="bg-ink p-1 border-4 border-ink shadow-[4px_4px_0px_0px_var(--color-active)] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all">
                  <X className="w-8 h-8 text-white" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 overflow-y-auto max-h-[50vh] pr-4 custom-scrollbar">
                {[
                  { title: "AUT Free Courses", desc: "Access full university-level courses for free (NZ residents only).", url: "https://www.aut.ac.nz/study/free-courses-and-financial-support", icon: BookOpen },
                  { title: "Business.govt.nz", desc: "The source of truth for NZ regulation, tax, and hiring laws.", url: "https://www.business.govt.nz/", icon: Target },
                  { title: "Regional Business Partners", desc: "Connect with local advisors to unlock funding and training.", url: "https://www.regionalbusinesspartners.co.nz/", icon: Users },
                  { title: "IRD: Starting a Business", desc: "Master your tax obligations before you earn your first dollar.", url: "https://www.ird.govt.nz/topics/starting-a-business", icon: Cpu },
                  { title: "Canva Design School", desc: "Free design training for professional branding and marketing.", url: "https://www.canva.com/designschool/", icon: Sparkles },
                  { title: "Free Digital Marketing", desc: "Gain certifications in SEO and Google Ads at no cost.", url: "https://skillshop.exceedlms.com/student/catalog/browse", icon: Zap }
                ].map((item, i) => (
                  <a 
                    key={i} 
                    href={item.url} 
                    target="_blank" 
                    rel="noreferrer"
                    className="p-6 border-4 border-ink hover:bg-neutral-50 transition-all group flex flex-col gap-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-1 hover:translate-y-1"
                  >
                    <item.icon className="w-8 h-8 text-active group-hover:scale-110 transition-transform" />
                    <h3 className="text-lg font-black uppercase italic">{item.title}</h3>
                    <p className="text-[10px] font-mono leading-tight opacity-60 uppercase">{item.desc}</p>
                  </a>
                ))}
              </div>

              <div className="p-6 bg-active/5 border-l-8 border-active italic font-black uppercase text-[10px] leading-tight">
                Warning: These resources are official channels. Ensure your NZ residency status matches the requirements for specific AUT subsidies.
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isAgentOpen && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-pop-cyan/90 backdrop-blur-md"
            style={{ backgroundImage: 'radial-gradient(rgba(0,0,0,0.2) 1px, transparent 1px)', backgroundSize: '10px 10px' }}
          >
    <motion.div 
      initial={{ scale: 0.9, opacity: 0, rotate: 1 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ scale: 0.9, opacity: 0, rotate: -1 }}
      className="bg-white border-8 border-ink w-full max-w-xl p-12 flex flex-col gap-10 shadow-[32px_32px_0px_0px_rgba(0,0,0,1)]"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex justify-between items-start border-b-6 border-ink pb-8">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-black uppercase bg-active text-white px-3 py-1 w-fit rotate-2">Innovation_Synthesis_v2</span>
          <h2 className="text-5xl font-black uppercase italic tracking-tighter text-outline-ink [text-shadow:4px_4px_0px_rgba(0,0,0,0.1)]">Discovery_Lab</h2>
        </div>
        <button onClick={() => setIsAgentOpen(false)} className="bg-white p-2 border-4 border-ink shadow-[4px_4px_0px_0px_#000] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all">
          <X className="w-10 h-10" />
        </button>
      </div>

              <div className="flex flex-col gap-8">
                <p className="font-black italic text-sm uppercase opacity-70 leading-tight border-l-8 border-pop-cyan pl-6 text-ink">
                  I will analyze your interests, location, or available tools to synthesize a unique, low-cost business vector that doesn't exist in our current index.
                </p>

                <div className="flex flex-col gap-3">
                  <label className="text-xs font-black uppercase italic opacity-60">Synthesis_Parameters</label>
                  <textarea 
                    className="w-full bg-white border-4 border-ink p-6 h-40 font-black italic text-sm outline-none focus:bg-pop-yellow/5 transition-all resize-none shadow-inner"
                    placeholder="E.G: I live in Raglan, I have a used van, and I know how to brew kombucha..."
                    value={agentPrompt}
                    onChange={e => {
                      setAgentPrompt(e.target.value);
                      if (agentError) setAgentError(null);
                    }}
                  />
                  {agentError && (
                    <motion.div 
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="text-[10px] font-black uppercase bg-pop-pink text-white px-4 py-2 border-2 border-ink italic"
                    >
                      {agentError}
                    </motion.div>
                  )}
                </div>

                <div className="flex flex-wrap gap-4">
                  {['Low Cost', 'AI Focused', 'Service Based', 'Digital Only'].map(tag => (
                    <button 
                      key={tag}
                      onClick={() => setAgentPrompt(prev => prev + (prev ? ' ' : '') + tag)}
                      className="text-[10px] font-black uppercase border-2 border-ink px-3 py-1 bg-white hover:bg-pop-yellow shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all italic active:translate-y-1 active:shadow-none"
                    >
                      +{tag}
                    </button>
                  ))}
                </div>

        <motion.button 
           onClick={handleSynthesizeNiche}
           disabled={isSynthesizing || !agentPrompt.trim()}
           className="w-full py-8 bg-active text-white border-4 border-ink font-black uppercase text-xl italic tracking-[0.2em] shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[-4px] active:translate-y-4 active:shadow-none transition-all flex items-center justify-center gap-6"
        >
          {isSynthesizing ? (
            <>
              <Loader2 className="w-8 h-8 animate-spin" />
              CALCULATING_MATRIX...
            </>
          ) : (
            <>
              <Cpu className="w-8 h-8" />
              GENERATE_BLUEPRINT
            </>
          )}
        </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Recommendation Quiz Modal */}
      <AnimatePresence>
        {isQuizOpen && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-pop-cyan/40 backdrop-blur-md"
            style={{ backgroundImage: 'radial-gradient(rgba(0,0,0,0.2) 1px, transparent 1px)', backgroundSize: '10px 10px' }}
          >
            <motion.div 
              initial={{ y: 50, opacity: 0, scale: 0.9 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 50, opacity: 0, scale: 0.9 }}
              className="bg-white border-8 border-ink w-full max-w-2xl p-12 flex flex-col gap-10 shadow-[24px_24px_0px_0px_rgba(0,0,0,1)] relative overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-between items-start border-b-6 border-ink pb-8">
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-black uppercase bg-pop-yellow text-ink px-3 py-1 w-fit rotate-[-2deg]">NEURAL_POP_ENGINE.v4</span>
                  <h2 className="text-5xl font-black uppercase italic tracking-tighter leading-none text-outline-ink [text-shadow:4px_4px_0px_#FF0266]">Niche Matching</h2>
                </div>
                <button onClick={() => setIsQuizOpen(false)} className="bg-pop-pink p-2 border-4 border-ink shadow-[4px_4px_0px_0px_#000] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all">
                  <X className="w-10 h-10 text-white" />
                </button>
              </div>

              {quizStep === 0 && (
                <div className="space-y-8">
                   <p className="font-black text-sm uppercase italic border-l-8 border-pop-pink pl-6 leading-tight">PHASE 01: Resource_Audit // What is your manageable startup budget for a new NZ venture?</p>
                   <div className="grid grid-cols-5 gap-3">
                      {[...Array(10)].map((_, i) => (
                        <button 
                          key={i} 
                          onClick={() => { setQuizData({...quizData, budget: i+1}); setQuizStep(1); }}
                          className={cn("h-16 border-4 border-ink flex items-center justify-center text-xl font-black italic transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-y-1", (i+1) <= quizData.budget ? "bg-pop-yellow text-ink" : "bg-white hover:bg-pop-yellow/20")}
                        >
                          {i+1}
                        </button>
                      ))}
                   </div>
                   <div className="flex justify-between font-black text-xs opacity-60 uppercase italic">
                      <span className="text-pop-cyan underline decoration-4 underline-offset-4">Cheap_Entry</span>
                      <span className="text-pop-pink underline decoration-4 underline-offset-4">Heavy_CapEx</span>
                   </div>
                </div>
              )}

              {quizStep === 1 && (
                <div className="space-y-8">
                   <p className="font-black text-sm uppercase italic border-l-8 border-pop-cyan pl-6 leading-tight">PHASE 02: Skill_Capacity // On a scale of 1-10, what is your current technical/business expertise?</p>
                   <div className="grid grid-cols-5 gap-3">
                      {[...Array(10)].map((_, i) => (
                        <button 
                          key={i} 
                          onClick={() => { setQuizData({...quizData, skill: i+1}); setQuizStep(2); }}
                          className={cn("h-16 border-4 border-ink flex items-center justify-center text-xl font-black italic transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-y-1", (i+1) <= quizData.skill ? "bg-pop-cyan text-white" : "bg-white hover:bg-pop-cyan/20")}
                        >
                          {i+1}
                        </button>
                      ))}
                   </div>
                   <div className="flex justify-between font-black text-xs opacity-60 uppercase italic">
                      <span>Beginner</span>
                      <span>Expert</span>
                   </div>
                </div>
              )}

              {quizStep === 2 && (
                <div className="space-y-8">
                   <p className="font-black text-sm uppercase italic border-l-8 border-pop-yellow pl-6 leading-tight">PHASE 03: Time_Allocation // How many hours per week can you realistically commit?</p>
                   <div className="grid grid-cols-5 gap-3">
                      {[...Array(10)].map((_, i) => (
                        <button 
                          key={i} 
                          onClick={() => { setQuizData({...quizData, time: i+1}); setQuizStep(3); }}
                          className={cn("h-16 border-4 border-ink flex items-center justify-center text-xl font-black italic transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-y-1", (i+1) <= quizData.time ? "bg-pop-pink text-white" : "bg-white hover:bg-pop-pink/20")}
                        >
                          {i+1}
                        </button>
                      ))}
                   </div>
                   <div className="flex justify-between font-black text-xs opacity-60 uppercase italic">
                      <span>Minimal_Side_Hustle</span>
                      <span>Full_Throttle</span>
                   </div>
                </div>
              )}

              {quizStep === 3 && (
                <div className="space-y-8">
                   <p className="font-black text-sm uppercase italic border-l-8 border-ink pl-6 leading-tight">PHASE 04: Interest_Alignment // Select industries that pique your focus.</p>
                   <div className="grid grid-cols-2 gap-4">
                      {['Digital', 'Service', 'Local', 'Creative', 'Tech'].map(cat => (
                        <button 
                          key={cat} 
                          onClick={() => {
                             const ints = quizData.interests.includes(cat) ? quizData.interests.filter(c => c !== cat) : [...quizData.interests, cat];
                             setQuizData({...quizData, interests: ints});
                          }}
                          className={cn("py-5 border-4 border-ink font-black uppercase text-xs tracking-widest flex items-center justify-between px-8 transition-all shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-y-2", quizData.interests.includes(cat) ? "bg-ink text-surface" : "bg-white hover:bg-pop-yellow/20")}
                        >
                          {cat}
                          {quizData.interests.includes(cat) && <CheckCircle2 className="w-6 h-6 text-pop-yellow" />}
                        </button>
                      ))}
                   </div>
                   <button 
                    onClick={handleQuizSubmit}
                    className="w-full mt-10 py-8 bg-pop-pink text-white font-black uppercase text-xl shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[-4px] active:translate-y-4 active:shadow-none transition-all italic tracking-[0.2em] border-4 border-ink"
                   >
                     EXECUTE_OPTIMIZATION
                   </button>
                </div>
              )}

              {quizStep === 4 && (
                <div className="space-y-8 overflow-y-auto max-h-[60vh] custom-scrollbar pr-6">
                   <p className="font-black text-sm uppercase italic border-l-8 border-pop-pink pl-6 mb-10 text-pop-pink">REPORT: Optimal Vectors Found // TARGETING ENHANCED</p>
                   <div className="flex flex-col gap-6">
                      {quizResults.map((niche, i) => (
                        <button 
                          key={niche.id}
                          onClick={() => { setSelectedNiche(niche); setIsQuizOpen(false); handleNicheClick(niche); }}
                          className="p-8 border-4 border-ink bg-white group hover:bg-pop-cyan transition-all flex justify-between items-center shadow-[8px_8px_0px_0px_#000] hover:shadow-[12px_12px_0px_0px_#FF0266] hover:translate-x-[-4px] hover:translate-y-[-4px]"
                        >
                            <div className="flex flex-col text-left gap-2">
                               <span className="text-[10px] font-black uppercase opacity-40 group-hover:opacity-100 group-hover:text-white transition-opacity tracking-widest text-pop-pink italic">Vector_Match: #{i+1} // DIFF: {calculateDifficultyScore(niche)}</span>
                               <h3 className="text-3xl font-black uppercase italic leading-none group-hover:text-white">{niche.title}</h3>
                            </div>
                            <ArrowUpRight className="w-10 h-10 group-hover:text-white group-hover:translate-x-2 group-hover:-translate-y-2 transition-all opacity-20 group-hover:opacity-100" />
                        </button>
                      ))}
                   </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Comparison Toolbar */}
      <AnimatePresence>
        {comparisonList.length > 0 && (
          <motion.div 
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            className="fixed bottom-6 md:bottom-12 left-1/2 -translate-x-1/2 z-40 bg-white text-ink px-4 md:px-8 py-4 md:py-6 flex flex-row items-center gap-4 md:gap-10 border-4 md:border-8 border-ink shadow-[8px_8px_0px_0px_rgba(3,54,255,1)] md:shadow-[16px_16px_0px_0px_rgba(3,54,255,1)] max-w-[95vw] md:max-w-none"
          >
            <div className="flex flex-col shrink-0">
              <span className="text-[8px] md:text-[10px] font-black uppercase tracking-widest opacity-60 italic">Selection_Active</span>
              <span className="text-sm md:text-xl font-black italic tracking-tighter whitespace-nowrap">{comparisonList.length} / 3 Nodes</span>
            </div>
            <div className="flex gap-1 md:gap-3">
              {comparisonList.map(n => (
                <div key={n.id} className="w-8 h-8 md:w-10 md:h-10 border-2 md:border-4 border-ink flex items-center justify-center relative group bg-pop-yellow shrink-0">
                  <span className="text-[10px] font-black italic">{n.id.slice(-2)}</span>
                  <button 
                    onClick={() => toggleCompare(n)}
                    className="absolute -top-2 -right-2 bg-pop-pink text-white border-2 border-ink rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-2 h-2" />
                  </button>
                </div>
              ))}
            </div>
            <button 
              onClick={() => setIsComparing(true)}
              className="bg-pop-pink text-surface px-3 md:px-6 py-2 md:py-3 text-[9px] md:text-[11px] font-black uppercase tracking-[0.1em] md:tracking-[0.2em] border-2 md:border-4 border-ink hover:translate-y-[-2px] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none transition-all rotate-1"
            >
              Analyze
            </button>
            <button onClick={() => setComparisonList([])} className="hidden sm:block text-[11px] font-black uppercase opacity-60 hover:opacity-100 underline decoration-pop-pink decoration-4">Clear</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Comparison Modal */}
      <AnimatePresence>
        {isComparing && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-pop-cyan/40 backdrop-blur-md"
            style={{ backgroundImage: 'radial-gradient(rgba(0,0,0,0.2) 1px, transparent 1px)', backgroundSize: '10px 10px' }}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, rotate: -2 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ scale: 0.9, opacity: 0, rotate: 2 }}
              className="bg-white border-8 border-ink w-full max-w-6xl p-12 flex flex-col gap-10 shadow-[40px_40px_0px_0px_rgba(0,0,0,1)] max-h-[90vh] overflow-hidden relative"
              onClick={e => e.stopPropagation()}
            >
        <div className="flex justify-between items-start border-b-6 border-ink pb-8">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-black uppercase bg-active text-white px-3 py-1 w-fit rotate-[-1deg]">DATA_COMPARISON_MATRIX.v1</span>
            <h2 className="text-6xl font-black uppercase italic tracking-tighter [text-shadow:4px_4px_0px_rgba(0,0,0,0.1)] text-outline-ink">Comparison Matrix</h2>
          </div>
          <button onClick={() => setIsComparing(false)} className="bg-white p-2 border-4 border-ink shadow-[4px_4px_0px_0px_#000000] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all">
            <X className="w-12 h-12" />
          </button>
        </div>

              <div className="flex-1 overflow-x-auto custom-scrollbar">
                <table className="w-full border-separate border-spacing-4">
                  <thead>
                    <tr>
                      <th className="p-4 text-left font-black uppercase text-xs opacity-60 italic">Metric_Index</th>
                      {comparisonList.map(n => (
                        <th key={n.id} className="p-6 text-left border-4 border-ink bg-pop-yellow shadow-[4px_4px_0px_0px_#000000]">
                          <div className="flex flex-col">
                            <span className="text-[10px] font-black text-pop-pink uppercase italic tracking-widest">{n.category}</span>
                            <span className="text-2xl font-black uppercase italic leading-none">{n.title}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="font-mono text-xs">
                    {[
                      { label: 'Difficulty', key: 'difficulty' },
                      { label: 'Startup Cost', key: 'startupCost', isBar: true },
                      { label: 'Time Commitment', key: 'timeCommitment', isBar: true },
                      { label: 'Market Saturation', key: 'marketSaturation', isBar: true },
                      { label: 'Skill Required', key: 'skillRequired', isBar: true },
                      { label: 'Potential', key: 'potential' },
                      { label: 'Efficiency Score', fn: (n: Niche) => calculateDifficultyScore(n) }
                    ].map((row, i) => (
                      <tr key={i} className="hover:bg-pop-yellow/10 transition-colors">
                        <td className="p-6 font-black uppercase text-sm border-b-4 border-ink italic">{row.label}</td>
                        {comparisonList.map(n => (
                          <td key={n.id} className="p-6 border-b-4 border-ink">
                            {row.isBar ? (
                              <div className="flex gap-1 w-full max-w-[160px]">
                                {[...Array(10)].map((_, idx) => (
                                  <div key={idx} className={cn("h-4 flex-1 border border-ink", idx < (n as any)[row.key!] ? "bg-pop-pink" : "bg-ink/5")} />
                                ))}
                              </div>
                            ) : (
                              <span className={cn("font-black text-3xl italic", row.label === 'Potential' ? "text-pop-pink [text-shadow:2px_2px_0px_#000] scale-110 inline-block" : "text-ink")}>
                                {row.fn ? row.fn(n) : (n as any)[row.key!]}
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-3 gap-8 p-10 bg-ink text-surface relative">
                <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(var(--color-surface) 1px, transparent 1px)', backgroundSize: '10px 10px' }} />
                {comparisonList.map((n, i) => (
                  <div key={n.id} className="flex flex-col gap-4 relative z-10">
                    <span className={cn("text-[10px] font-black uppercase bg-white text-ink px-2 py-0.5 w-fit", i % 2 === 0 ? "rotate-2" : "-rotate-2")}>Alpha_View // {n.id}</span>
                    <p className="text-xs leading-relaxed italic font-black uppercase opacity-80 line-clamp-3">"{n.shortDescription}"</p>
                    <button 
                      onClick={() => { handleNicheClick(n); setIsComparing(false); }}
                      className="text-xs font-black uppercase italic underline decoration-pop-yellow decoration-4 hover:text-pop-yellow transition-all w-fit"
                    >
                      Exfiltrate_Blueprint
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Onboarding Sequence */}
      <AnimatePresence>
        {onboardingStep >= 0 && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-pop-pink/60 backdrop-blur-md"
            style={{ backgroundImage: 'radial-gradient(white 1px, transparent 1px)', backgroundSize: '15px 15px' }}
          >
            <motion.div 
              key={onboardingStep}
              initial={{ y: 40, opacity: 0, rotate: -3 }} animate={{ y: 0, opacity: 1, rotate: 0 }} exit={{ y: -40, opacity: 0, rotate: 3 }}
              className="bg-white text-ink border-4 md:border-8 border-ink w-full max-w-xl p-6 md:p-12 flex flex-col gap-6 md:gap-10 shadow-[16px_16px_0px_0px_rgba(0,0,0,1)] md:shadow-[32px_32px_0px_0px_rgba(0,0,0,1)] text-center relative overflow-hidden"
            >
              <div className="absolute top-4 right-4 text-xs font-black italic opacity-40">
                BOOT_SEQUENCE // {onboardingStep + 1}_OF_4
              </div>

              {onboardingStep === 0 && (
                <>
                  <div className="flex justify-center mb-4"><Zap className="w-24 h-24 text-active fill-active stroke-ink stroke-[3] rotate-12" /></div>
                  <h2 className="text-6xl font-black uppercase italic tracking-tighter leading-none [text-shadow:4px_4px_0px_rgba(0,0,0,0.1)] text-outline-ink">CareerElevate</h2>
                  <p className="text-sm font-black uppercase leading-relaxed text-ink/80 bg-accent-bg p-6 border-4 border-dashed border-ink">
                    Bridging the gap between determination and industry entry. Access free tools and AUT certification paths today.
                  </p>
                </>
              )}

              {onboardingStep === 1 && (
                <>
                  <div className="grid grid-cols-2 gap-6 mb-4">
                    <div className="p-6 border-4 border-ink bg-pop-cyan text-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col items-center gap-3">
                      <BookOpen className="w-10 h-10" />
                      <span className="text-[10px] font-black uppercase italic">AUT_Education</span>
                    </div>
                    <div className="p-6 border-4 border-ink bg-active text-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col items-center gap-3">
                      <Cpu className="w-10 h-10" />
                      <span className="text-[10px] font-black uppercase italic">Resource_Mapping</span>
                    </div>
                  </div>
                  <h2 className="text-4xl font-black uppercase italic tracking-tighter leading-none border-b-6 border-ink pb-2">The Blueprint</h2>
                  <p className="text-sm font-black uppercase leading-relaxed text-ink/80 italic">
                    Identify industries with low barriers to entry. We provide the roadmap to go from Zero skills to Industry-ready in under 90 days.
                  </p>
                </>
              )}

              {onboardingStep === 2 && (
                <>
                  <div className="flex justify-center mb-4"><Brain className="w-20 h-20 text-pop-cyan fill-pop-cyan stroke-ink stroke-[2] -rotate-6" /></div>
                  <h2 className="text-4xl font-black uppercase italic tracking-tighter leading-none border-b-6 border-ink pb-2">The Alpha Score</h2>
                  <div className="bg-ink text-white p-6 border-4 border-pop-yellow shadow-[8px_8px_0px_0px_var(--color-pop-yellow)]">
                     <p className="text-xs font-black uppercase italic opacity-70 mb-4">Calculation Formula:</p>
                     <p className="text-lg font-black italic text-pop-yellow leading-tight tracking-tighter">(0.4 × Cost) + (0.3 × Skill) + (0.2 × Commitment) + (0.1 × Saturation)</p>
                  </div>
                  <p className="text-sm font-black uppercase leading-relaxed opacity-70 mt-4 italic text-ink">
                    Focus on scores under 4.0 for rapid starts.
                  </p>
                </>
              )}

              {onboardingStep === 3 && (
                <>
                   <div className="flex justify-center mb-4"><Target className="w-24 h-24 text-pop-pink fill-pop-pink stroke-ink stroke-[3] animate-pulse" /></div>
                  <h2 className="text-5xl font-black uppercase italic tracking-tighter leading-none border-b-8 border-ink pb-2">Target Lock</h2>
                  <p className="text-sm font-black uppercase leading-relaxed text-ink italic p-6 bg-pop-cyan/10 border-4 border-ink border-dotted">
                    Select a niche to unlock localized action plans, competitive analysis, market trends, and direct links to NZ funding sources.
                  </p>
                </>
              )}

              <div className="flex gap-4 mt-4 relative z-10">
                {onboardingStep > 0 && (
                  <button 
                    onClick={() => setOnboardingStep(prev => prev - 1)}
                    className="flex-1 py-5 border-4 border-ink bg-white font-black uppercase text-xs tracking-widest hover:bg-pop-yellow shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none transition-all"
                  >
                    Previous
                  </button>
                )}
                <button 
                  onClick={() => onboardingStep === 3 ? finishOnboarding() : setOnboardingStep(prev => prev + 1)}
                  className="flex-[2] py-5 bg-pop-pink text-white border-4 border-ink font-black uppercase text-xs tracking-[0.4em] hover:brightness-110 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] active:shadow-none translate-y-[-4px] active:translate-y-0 transition-all flex items-center justify-center gap-3"
                >
                  {onboardingStep === 3 ? 'ENTER_THE_GRID' : 'NEXT_SEQUENCE'}
                  <ArrowUpRight className="w-5 h-5" />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Daily Archive Modal */}
      <AnimatePresence>
        {isArchiveOpen && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-pop-cyan/90 backdrop-blur-md"
            style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.3) 1px, transparent 1px)', backgroundSize: '12px 12px' }}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, rotate: 1 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ scale: 0.9, opacity: 0, rotate: -1 }}
              className="bg-white border-8 border-ink w-full max-w-5xl p-12 flex flex-col gap-10 shadow-[32px_32px_0px_0px_rgba(0,0,0,1)] max-h-[85vh] overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-between items-start border-b-6 border-ink pb-8">
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-black uppercase bg-active text-white px-3 py-1 w-fit rotate-2">HISTORICAL_INDEX_v1</span>
                  <h2 className="text-6xl font-black uppercase italic tracking-tighter [text-shadow:4px_4px_0px_rgba(0,0,0,0.1)] text-outline-ink">Resource Vault</h2>
                </div>
                <button onClick={() => setIsArchiveOpen(false)} className="bg-active p-3 border-4 border-ink shadow-[4px_4px_0px_0px_#000] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all">
                  <X className="w-12 h-12 text-white" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar pr-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {dailyNiches.length === 0 ? (
                    <div className="col-span-full py-24 flex flex-col items-center gap-6 opacity-30">
                       <Clock className="w-16 h-16 font-black" />
                       <span className="text-xl font-black uppercase italic tracking-[0.4em]">Vault_Empty...</span>
                    </div>
                  ) : (
                    dailyNiches.map((niche, i) => (
                      <motion.div 
                        key={niche.id}
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: i * 0.05 }}
                        onClick={() => {
                          handleNicheClick(niche);
                          setIsArchiveOpen(false);
                        }}
                        className="bg-white border-4 border-ink p-8 hover:translate-x-[-8px] hover:translate-y-[-8px] hover:shadow-[12px_12px_0px_0px_rgba(3,54,255,1)] cursor-pointer transition-all flex flex-col justify-between group relative overflow-hidden"
                      >
                        <div className="flex flex-col gap-4 relative z-10">
                           <div className="flex justify-between items-start">
                              <span className="text-[10px] font-black italic bg-pop-yellow px-2 py-1 border-2 border-ink">{(niche as any).publishDate}</span>
                              <span className="text-[10px] font-black text-white bg-pop-pink uppercase border-2 border-ink px-2 py-1 rotate-3">{niche.category}</span>
                           </div>
                           <h3 className="text-2xl font-black uppercase italic leading-none group-hover:text-pop-cyan transition-colors mt-2">{niche.title}</h3>
                           <p className="text-xs font-black uppercase opacity-60 line-clamp-3 leading-tight italic">"{niche.shortDescription}"</p>
                        </div>
                        <div className="mt-8 flex justify-between items-center border-t-4 border-ink/10 pt-6 relative z-10">
                           <span className="text-xs font-black uppercase italic tracking-widest text-pop-cyan">{niche.potential} ALPHA</span>
                           <ArrowUpRight className="w-6 h-6 group-hover:translate-x-2 group-hover:-translate-y-2 transition-transform" />
                        </div>
                        <div className="absolute top-0 right-0 w-24 h-24 bg-pop-yellow/5 -mr-12 -mt-12 rounded-full group-hover:scale-150 transition-transform duration-700" />
                      </motion.div>
                    ))
                  )}
                </div>
              </div>

              <div className="p-6 bg-ink text-surface font-black uppercase italic tracking-widest flex justify-between border-t-8 border-pop-yellow">
                <span className="text-pop-yellow">TOTAL_ARCHIVED_NODES: {dailyNiches.length}</span>
                <span className="opacity-60 italic">AUTO_ARCHIVE_ACTIVE // 24H_CYCLE</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
