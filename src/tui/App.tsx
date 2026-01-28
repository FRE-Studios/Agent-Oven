import React, { useState, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { Config } from '../core/types.js';
import type { Screen } from './types.js';
import { Dashboard } from './components/Dashboard.js';
import { JobList } from './components/JobList.js';
import { JobForm } from './components/JobForm.js';
import { JobDetail } from './components/JobDetail.js';
import { LogViewer } from './components/LogViewer.js';

interface AppProps {
  config: Config;
}

export function App({ config }: AppProps) {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>({ type: 'dashboard' });
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Clear message after a few seconds
  const showMessage = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  }, []);

  // Navigate to a screen
  const navigate = useCallback((newScreen: Screen) => {
    setScreen(newScreen);
  }, []);

  // Go back to previous screen
  const goBack = useCallback(() => {
    switch (screen.type) {
      case 'job-form':
      case 'job-detail':
        setScreen({ type: 'jobs' });
        break;
      case 'logs':
        if (screen.jobId) {
          setScreen({ type: 'job-detail', jobId: screen.jobId });
        } else {
          setScreen({ type: 'dashboard' });
        }
        break;
      case 'jobs':
        setScreen({ type: 'dashboard' });
        break;
      default:
        break;
    }
  }, [screen]);

  // Global keyboard shortcuts
  useInput((input, key) => {
    // Quit on 'q' from dashboard, or Ctrl+C anywhere
    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

    // 'q' to quit only from dashboard
    if (screen.type === 'dashboard' && input === 'q') {
      exit();
      return;
    }

    // Escape to go back
    if (key.escape) {
      if (screen.type === 'dashboard') {
        exit();
      } else {
        goBack();
      }
      return;
    }

    // Global navigation shortcuts from dashboard
    if (screen.type === 'dashboard') {
      switch (input) {
        case 'j':
          navigate({ type: 'jobs' });
          break;
        case 'a':
          navigate({ type: 'job-form' });
          break;
        case 'l':
          navigate({ type: 'logs' });
          break;
      }
    }
  });

  // Render current screen
  const renderScreen = () => {
    switch (screen.type) {
      case 'dashboard':
        return (
          <Dashboard
            config={config}
            onNavigate={navigate}
          />
        );

      case 'jobs':
        return (
          <JobList
            config={config}
            onSelect={(job) => navigate({ type: 'job-detail', jobId: job.id })}
            onAdd={() => navigate({ type: 'job-form' })}
            onBack={goBack}
            onMessage={showMessage}
          />
        );

      case 'job-form':
        return (
          <JobForm
            config={config}
            existingJob={screen.job}
            onSave={(job) => {
              showMessage(`Job "${job.name}" saved`, 'success');
              navigate({ type: 'jobs' });
            }}
            onCancel={goBack}
          />
        );

      case 'job-detail':
        return (
          <JobDetail
            config={config}
            jobId={screen.jobId}
            onEdit={(job) => navigate({ type: 'job-form', job })}
            onViewLogs={(logFile) => navigate({ type: 'logs', jobId: screen.jobId, logFile })}
            onBack={goBack}
            onMessage={showMessage}
          />
        );

      case 'logs':
        return (
          <LogViewer
            config={config}
            jobId={screen.jobId}
            logFile={screen.logFile}
            onBack={goBack}
          />
        );

      default:
        return <Text>Unknown screen</Text>;
    }
  };

  return (
    <Box flexDirection="column">
      {renderScreen()}

      {/* Status message */}
      {message && (
        <Box marginTop={1}>
          <Text color={message.type === 'error' ? 'red' : 'green'}>
            {message.type === 'error' ? '✗' : '✓'} {message.text}
          </Text>
        </Box>
      )}
    </Box>
  );
}
