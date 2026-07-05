"use client";

import { useState, useEffect, useRef } from 'react';
import { API_CONFIG } from '@/app/lib/map-config';
import styles from './TileProgress.module.css';

interface TileStats {
  total: number;
  completed: number;
  failed: number;
  pending: number;
}

interface MemoryInfo {
  total_gb: number;
  used_gb: number;
  free_gb: number;
  process_rss_gb: number;
  percent: number;
}

interface TileProgressProps {
  taskId: string;
  isProcessing: boolean;
}

export default function TileProgress({ taskId, isProcessing }: TileProgressProps) {
  const [stats, setStats] = useState<TileStats>({ total: 0, completed: 0, failed: 0, pending: 0 });
  const [memoryInfo, setMemoryInfo] = useState<MemoryInfo | null>(null);
  const [prevCompleted, setPrevCompleted] = useState<number>(0);
  const [animatePulse, setAnimatePulse] = useState<boolean>(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTileStats = async () => {
    try {
      const endpoint = `${API_CONFIG.baseURL}${API_CONFIG.endpoints.status.replace('{task_id}', taskId)}`;
      const resp = await fetch(endpoint, { cache: 'no-store' });
      if (!resp.ok) return;
      const data = await resp.json();

      if (data.tile_stats && data.tile_stats.total > 0) {
        const newStats: TileStats = data.tile_stats;
        
        // تحريك النبض عند تغير العدد
        if (newStats.completed !== prevCompleted) {
          setAnimatePulse(true);
          setTimeout(() => setAnimatePulse(false), 600);
          setPrevCompleted(newStats.completed);
        }
        
        setStats(newStats);
      }

      if (data.memory_info) {
        setMemoryInfo(data.memory_info);
      }

      // إيقاف الاستعلام عند الاكتمال أو عدم وجود المهمة
      if (data.status === 'COMPLETED' || data.status === 'FAILED' || data.status === 'NOT_FOUND') {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    } catch (err) {
      console.warn('[TileProgress] fetch error', err);
    }
  };

  useEffect(() => {
    if (!taskId || !isProcessing) return;

    // جلب فوري
    fetchTileStats();

    // جلب دوري كل 4 ثوانٍ
    intervalRef.current = setInterval(fetchTileStats, 4000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [taskId, isProcessing]);

  // لا تعرض شيئاً إذا لم تبدأ المعالجة بعد
  if (stats.total === 0) return null;

  const percentage = Math.round((stats.completed / stats.total) * 100);
  const failPercentage = Math.round((stats.failed / stats.total) * 100);

  return (
    <div className={styles.container}>
      {/* العنوان */}
      <div className={styles.header}>
        <span className={styles.headerIcon}>🧩</span>
        <h4 className={styles.headerTitle}>تقدم معالجة القطع (Tiles)</h4>
      </div>

      {/* شريط التقدم */}
      <div className={styles.progressBar}>
        <div
          className={styles.progressFill}
          style={{ width: `${percentage}%` }}
        />
        {stats.failed > 0 && (
          <div
            className={styles.progressFailed}
            style={{ width: `${failPercentage}%`, left: `${percentage}%` }}
          />
        )}
      </div>

      {/* الإحصائيات */}
      <div className={styles.statsGrid}>
        {/* الإجمالي */}
        <div className={styles.statCard}>
          <span className={styles.statIcon}>📦</span>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>الإجمالي</span>
            <span className={`${styles.statValue} ${styles.totalValue}`}>{stats.total}</span>
          </div>
        </div>

        {/* المكتملة */}
        <div className={`${styles.statCard} ${animatePulse ? styles.pulse : ''}`}>
          <span className={styles.statIcon}>✅</span>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>المكتملة</span>
            <span className={`${styles.statValue} ${styles.completedValue}`}>{stats.completed}</span>
          </div>
        </div>

        {/* المتبقية */}
        <div className={styles.statCard}>
          <span className={styles.statIcon}>⏳</span>
          <div className={styles.statInfo}>
            <span className={styles.statLabel}>المتبقية</span>
            <span className={`${styles.statValue} ${styles.pendingValue}`}>{stats.pending}</span>
          </div>
        </div>

        {/* الفاشلة */}
        {stats.failed > 0 && (
          <div className={styles.statCard}>
            <span className={styles.statIcon}>❌</span>
            <div className={styles.statInfo}>
              <span className={styles.statLabel}>فشلت</span>
              <span className={`${styles.statValue} ${styles.failedValue}`}>{stats.failed}</span>
            </div>
          </div>
        )}
      </div>

      {/* عرض مراقب الذاكرة RAM */}
      {memoryInfo && memoryInfo.total_gb > 0 && (
        <div className={styles.memoryContainer}>
          <div className={styles.memoryHeader}>
            <div className={styles.memoryTitleGroup}>
              <span className={styles.memoryIcon}>💾</span>
              <span className={styles.memoryTitle}>استهلاك الذاكرة عشوائية (RAM)</span>
            </div>
            <span className={styles.memoryProcessBadge}>البرنامج الحالي: {memoryInfo.process_rss_gb} GB</span>
          </div>
          <div className={styles.memoryBarContainer}>
            <div 
              className={`${styles.memoryBarFill} ${memoryInfo.percent > 80 ? styles.memoryDanger : memoryInfo.percent > 65 ? styles.memoryWarning : ''}`}
              style={{ width: `${memoryInfo.percent}%` }}
            />
          </div>
          <div className={styles.memoryLabels}>
            <span>المستخدم: {memoryInfo.used_gb} GB ({memoryInfo.percent}%)</span>
            <span>المتبقي: {memoryInfo.free_gb} GB من {memoryInfo.total_gb} GB</span>
          </div>
        </div>
      )}

      {/* النسبة */}
      <div className={styles.percentageRow}>
        <span className={styles.percentageText}>{percentage}% مكتمل</span>
        {isProcessing && stats.pending > 0 && (
          <span className={styles.processingBadge}>
            <span className={styles.dot}></span>
            جاري المعالجة
          </span>
        )}
        {stats.pending === 0 && stats.total > 0 && (
          <span className={styles.doneBadge}>✨ اكتمل التقطيع</span>
        )}
      </div>
    </div>
  );
}
