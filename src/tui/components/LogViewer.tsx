import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import type { Config } from '../../core/types.js';
import { readJobLog, readSchedulerLog, getJobLogFiles } from '../../core/docker.js';

interface LogViewerProps {
  config: Config;
  jobId?: string;
  logFile?: string;
  onBack: () => void;
}

export function LogViewer({ config, jobId, logFile, onBack }: LogViewerProps) {
  const { stdout } = useStdout();
  const [content, setContent] = useState<string[]>([]);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [follow, setFollow] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(logFile ?? null);
  const [availableFiles, setAvailableFiles] = useState<string[]>([]);
  const [fileSelectMode, setFileSelectMode] = useState(false);
  const [fileSelectIndex, setFileSelectIndex] = useState(0);

  // Calculate visible lines based on terminal height
  const terminalHeight = stdout?.rows ?? 24;
  const visibleLines = Math.max(5, terminalHeight - 8); // Leave room for header/footer

  // Load available log files
  useEffect(() => {
    if (jobId) {
      const files = getJobLogFiles(config, jobId);
      setAvailableFiles(files);

      // Auto-select most recent if none specified
      if (!selectedFile && files.length > 0) {
        setSelectedFile(files[0]);
      }
    }
  }, [config, jobId, selectedFile]);

  // Load log content
  const loadContent = useCallback(() => {
    let logContent: string;

    if (selectedFile) {
      logContent = readJobLog(selectedFile);
    } else if (jobId) {
      // Get most recent log for job
      const files = getJobLogFiles(config, jobId);
      if (files.length > 0) {
        logContent = readJobLog(files[0]);
        setSelectedFile(files[0]);
      } else {
        logContent = 'No logs found for this job.';
      }
    } else {
      // Show scheduler log
      logContent = readSchedulerLog(config, 100);
      if (!logContent) {
        logContent = 'No scheduler logs found.';
      }
    }

    const lines = logContent.split('\n');
    setContent(lines);

    // Auto-scroll to bottom if following
    if (follow) {
      setScrollOffset(Math.max(0, lines.length - visibleLines));
    }
  }, [config, jobId, selectedFile, follow, visibleLines]);

  // Initial load
  useEffect(() => {
    loadContent();
  }, [loadContent]);

  // Auto-refresh when following
  useEffect(() => {
    if (follow) {
      const interval = setInterval(loadContent, 1000);
      return () => clearInterval(interval);
    }
  }, [follow, loadContent]);

  // Handle keyboard input
  useInput((input, key) => {
    if (fileSelectMode) {
      if (key.upArrow) {
        setFileSelectIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setFileSelectIndex((i) => Math.min(availableFiles.length - 1, i + 1));
      } else if (key.return) {
        setSelectedFile(availableFiles[fileSelectIndex]);
        setFileSelectMode(false);
        setScrollOffset(0);
      } else if (key.escape) {
        setFileSelectMode(false);
      }
      return;
    }

    // Scroll
    if (key.upArrow || input === 'k') {
      setScrollOffset((o) => Math.max(0, o - 1));
      setFollow(false);
    } else if (key.downArrow || input === 'j') {
      setScrollOffset((o) => Math.min(content.length - visibleLines, o + 1));
    } else if (key.pageUp) {
      setScrollOffset((o) => Math.max(0, o - visibleLines));
      setFollow(false);
    } else if (key.pageDown) {
      setScrollOffset((o) => Math.min(content.length - visibleLines, o + visibleLines));
    }

    // Toggle follow
    if (input === 'f') {
      setFollow((f) => !f);
      if (!follow) {
        setScrollOffset(Math.max(0, content.length - visibleLines));
      }
    }

    // Open file selector
    if (input === 'o' && availableFiles.length > 1) {
      setFileSelectMode(true);
      const idx = availableFiles.indexOf(selectedFile ?? '');
      setFileSelectIndex(idx >= 0 ? idx : 0);
    }

    // Go to top/bottom
    if (input === 'g') {
      setScrollOffset(0);
      setFollow(false);
    } else if (input === 'G') {
      setScrollOffset(Math.max(0, content.length - visibleLines));
    }

    // Refresh
    if (input === 'r') {
      loadContent();
    }
  });

  // Get visible content
  const visibleContent = content.slice(scrollOffset, scrollOffset + visibleLines);
  const atBottom = scrollOffset >= content.length - visibleLines;

  // Title
  let title = 'Scheduler Log';
  if (selectedFile) {
    // Extract job id and timestamp from path
    const parts = selectedFile.split('/');
    const filename = parts[parts.length - 1];
    const jobFolder = parts[parts.length - 2];
    title = `Logs: ${jobFolder} - ${filename.replace('.log', '')}`;
  } else if (jobId) {
    title = `Logs: ${jobId}`;
  }

  // File select mode
  if (fileSelectMode) {
    return (
      <Box flexDirection="column">
        <Text bold color="magenta">Select Log File</Text>
        <Box flexDirection="column" marginTop={1} borderStyle="single" paddingX={1}>
          {availableFiles.map((file, index) => {
            const parts = file.split('/');
            const filename = parts[parts.length - 1].replace('.log', '');
            return (
              <Box key={file}>
                <Text color={index === fileSelectIndex ? 'cyan' : undefined}>
                  {index === fileSelectIndex ? '▸ ' : '  '}{filename}
                </Text>
              </Box>
            );
          })}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>[enter] Select  [esc] Cancel</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box>
        <Text bold color="magenta">{title}</Text>
        {follow && (
          <Text color="cyan"> [following]</Text>
        )}
      </Box>

      {/* Content */}
      <Box
        flexDirection="column"
        borderStyle="single"
        paddingX={1}
        height={visibleLines + 2}
      >
        {visibleContent.length === 0 ? (
          <Text dimColor>No content</Text>
        ) : (
          visibleContent.map((line, index) => (
            <Text key={scrollOffset + index} wrap="truncate">
              {formatLogLine(line)}
            </Text>
          ))
        )}
      </Box>

      {/* Scroll indicator */}
      <Box>
        <Text dimColor>
          Lines {scrollOffset + 1}-{Math.min(scrollOffset + visibleLines, content.length)} of {content.length}
          {!atBottom && <Text color="yellow"> (more below)</Text>}
        </Text>
      </Box>

      {/* Shortcuts */}
      <Box marginTop={1}>
        <Text dimColor>
          [↑/↓] Scroll  [f] Follow{follow ? ' (on)' : ''}  [g/G] Top/Bottom
          {availableFiles.length > 1 && '  [o] Older runs'}
          {'  [r] Refresh  [esc] Back'}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Format a log line with syntax highlighting
 */
function formatLogLine(line: string): React.ReactNode {
  // Header lines
  if (line.startsWith('===')) {
    return <Text color="cyan">{line}</Text>;
  }

  // Error indicators
  if (line.toLowerCase().includes('error') || line.toLowerCase().includes('failed')) {
    return <Text color="red">{line}</Text>;
  }

  // Warning indicators
  if (line.toLowerCase().includes('warning') || line.toLowerCase().includes('warn')) {
    return <Text color="yellow">{line}</Text>;
  }

  // Success indicators
  if (line.includes('Exit Code: 0') || line.toLowerCase().includes('success')) {
    return <Text color="green">{line}</Text>;
  }

  // Timestamp pattern
  if (/^\[\d{4}-\d{2}-\d{2}/.test(line)) {
    const match = line.match(/^(\[[^\]]+\])\s*(.*)/);
    if (match) {
      return (
        <Text>
          <Text dimColor>{match[1]}</Text> {match[2]}
        </Text>
      );
    }
  }

  return <Text>{line}</Text>;
}
