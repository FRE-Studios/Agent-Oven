import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import {
  setupFiles,
  discoverImages,
  buildImage,
  detectTimezone,
  verifyDocker,
  buildConfig,
} from '../../core/setup.js';
import { platform } from '../../core/platform.js';

interface DependencyStatus {
  installed: boolean;
  version?: string;
}

type Step =
  | 'welcome'
  | 'prerequisites'
  | 'dependencies'
  | 'colima-config'
  | 'colima-start'
  | 'docker-verify'
  | 'files-setup'
  | 'image-select'
  | 'image-build'
  | 'timezone'
  | 'daemon'
  | 'summary';

type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

interface PrereqResult {
  name: string;
  status: DependencyStatus;
}

export function InitWizard() {
  const { exit } = useApp();
  const [step, setStep] = useState<Step>('welcome');
  const [error, setError] = useState<string | null>(null);

  // Collected config values
  const [projectDir] = useState(process.cwd());
  const [cpu, setCpu] = useState('2');
  const [memory, setMemory] = useState('4');
  const [disk, setDisk] = useState('20');
  const [timezone, setTimezone] = useState('');
  const [editTimezone, setEditTimezone] = useState(false);

  // Prerequisites state
  const [prereqs, setPrereqs] = useState<PrereqResult[]>([]);
  const [prereqsDone, setPrereqsDone] = useState(false);
  const [missingDeps, setMissingDeps] = useState<string[]>([]);

  // Dependencies install state
  const [depStatuses, setDepStatuses] = useState<Record<string, StepStatus>>({});
  const [depOutput, setDepOutput] = useState('');
  const [depsDone, setDepsDone] = useState(false);

  // Colima state
  const [colimaRunning, setColimaRunning] = useState(false);
  const [colimaStatus, setColimaStatus] = useState<StepStatus>('pending');

  // Docker verify state
  const [dockerStatus, setDockerStatus] = useState<StepStatus>('pending');
  const [dockerVersion, setDockerVersion] = useState('');

  // Files setup state
  const [filesResult, setFilesResult] = useState<{ created: string[]; existed: string[] } | null>(null);

  // Image state
  const [availableImages, setAvailableImages] = useState<string[]>([]);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [imageCursor, setImageCursor] = useState(0);

  // Image build state
  const [buildStatuses, setBuildStatuses] = useState<Record<string, StepStatus>>({});
  const [buildOutput, setBuildOutput] = useState('');
  const [buildsDone, setBuildsDone] = useState(false);

  // Daemon state
  const [daemonStatus, setDaemonStatus] = useState<StepStatus>('pending');

  // Active field for colima-config form
  const [configField, setConfigField] = useState<'cpu' | 'memory' | 'disk'>('cpu');

  // Summary items
  const [summaryItems, setSummaryItems] = useState<{ label: string; value: string; ok: boolean }[]>([]);

  // --- Step: prerequisites ---
  useEffect(() => {
    if (step !== 'prerequisites') return;
    let cancelled = false;

    const run = async () => {
      const results: PrereqResult[] = [];

      // Check package manager (Homebrew on macOS, no-op on Linux)
      const pkgMgr = await platform.checkPackageManager();
      if (cancelled) return;

      if (platform.needsVM) {
        // On macOS, Homebrew is required
        results.push({ name: 'homebrew', status: { installed: pkgMgr.available, version: pkgMgr.version } });
        setPrereqs([...results]);

        if (!pkgMgr.available) {
          setError('Homebrew is required. Install it from https://brew.sh');
          setPrereqsDone(true);
          return;
        }
      }

      for (const dep of platform.prerequisites) {
        const status = await platform.checkDependency(dep);
        if (cancelled) return;
        results.push({ name: dep, status });
        setPrereqs([...results]);
      }

      const missing = results
        .filter((r) => r.name !== 'homebrew' && !r.status.installed)
        .map((r) => r.name);
      setMissingDeps(missing);
      setPrereqsDone(true);
    };

    run();
    return () => { cancelled = true; };
  }, [step]);

  // --- Step: dependencies ---
  useEffect(() => {
    if (step !== 'dependencies') return;
    let cancelled = false;

    const run = async () => {
      const statuses: Record<string, StepStatus> = {};
      for (const dep of missingDeps) {
        statuses[dep] = 'pending';
      }
      setDepStatuses({ ...statuses });

      for (const dep of missingDeps) {
        if (cancelled) return;
        statuses[dep] = 'running';
        setDepStatuses({ ...statuses });
        setDepOutput('');

        const result = await platform.installPackage(dep, (line) => {
          if (!cancelled) setDepOutput(line);
        });

        if (cancelled) return;
        statuses[dep] = result === 'failed' ? 'failed' : 'done';
        setDepStatuses({ ...statuses });

        if (result === 'failed') {
          setError(`Failed to install ${dep}. Please install it manually.`);
          return;
        }
      }

      setDepsDone(true);
    };

    run();
    return () => { cancelled = true; };
  }, [step, missingDeps]);

  // --- Step: colima-start ---
  useEffect(() => {
    if (step !== 'colima-start') return;
    let cancelled = false;

    const run = async () => {
      setColimaStatus('running');

      // Check if already running
      const status = await platform.getRuntimeStatus();
      if (cancelled) return;

      if (status.running) {
        setColimaRunning(true);
        setColimaStatus('done');
        return;
      }

      try {
        const config = {
          projectDir,
          colima: { cpu: parseInt(cpu, 10), memory: parseInt(memory, 10), disk: parseInt(disk, 10) },
          docker: { defaultCpus: 1, defaultMemory: '512m' },
          timezone: timezone || detectTimezone(),
        };
        await platform.startRuntime(config);
        if (cancelled) return;
        setColimaRunning(true);
        setColimaStatus('done');
      } catch (err) {
        if (cancelled) return;
        setColimaStatus('failed');
        setError(err instanceof Error ? err.message : 'Failed to start runtime');
      }
    };

    run();
    return () => { cancelled = true; };
  }, [step, projectDir, cpu, memory, disk, timezone]);

  // --- Step: docker-verify ---
  useEffect(() => {
    if (step !== 'docker-verify') return;
    let cancelled = false;

    const run = async () => {
      setDockerStatus('running');
      const result = await verifyDocker();
      if (cancelled) return;

      if (result.available) {
        setDockerVersion(result.version ?? 'unknown');
        setDockerStatus('done');
      } else {
        setDockerStatus('failed');
        setError(
          platform.needsVM
            ? 'Docker is not responding. Check Colima status.'
            : 'Docker is not responding. Start Docker and retry.',
        );
      }
    };

    run();
    return () => { cancelled = true; };
  }, [step]);

  // --- Step: files-setup ---
  useEffect(() => {
    if (step !== 'files-setup') return;
    try {
      const result = setupFiles(projectDir);
      setFilesResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create files');
    }
  }, [step, projectDir]);

  // --- Step: image-select ---
  useEffect(() => {
    if (step !== 'image-select') return;
    const images = discoverImages(projectDir);
    setAvailableImages(images);
    setSelectedImages(new Set(images)); // Select all by default
  }, [step, projectDir]);

  // --- Step: image-build ---
  useEffect(() => {
    if (step !== 'image-build') return;
    let cancelled = false;

    const run = async () => {
      const images = Array.from(selectedImages);
      const statuses: Record<string, StepStatus> = {};
      for (const img of images) {
        statuses[img] = 'pending';
      }
      setBuildStatuses({ ...statuses });

      for (const img of images) {
        if (cancelled) return;
        statuses[img] = 'running';
        setBuildStatuses({ ...statuses });
        setBuildOutput('');

        const result = await buildImage(projectDir, img, (line) => {
          if (!cancelled) setBuildOutput(line);
        });

        if (cancelled) return;
        statuses[img] = result.success ? 'done' : 'failed';
        setBuildStatuses({ ...statuses });

        if (!result.success) {
          setError(`Failed to build ${img}: ${result.error}`);
        }
      }

      setBuildsDone(true);
    };

    run();
    return () => { cancelled = true; };
  }, [step, selectedImages, projectDir]);

  // --- Step: timezone ---
  useEffect(() => {
    if (step !== 'timezone') return;
    setTimezone(detectTimezone());
  }, [step]);

  // --- Step: daemon ---
  useEffect(() => {
    if (step !== 'daemon') return;
    let cancelled = false;

    const run = async () => {
      setDaemonStatus('running');
      const result = await platform.installDaemon(projectDir);
      if (cancelled) return;

      if (result.success) {
        setDaemonStatus('done');
      } else {
        setDaemonStatus('failed');
        setError(result.error ?? 'Failed to install scheduler daemon');
      }
    };

    run();
    return () => { cancelled = true; };
  }, [step, projectDir]);

  // --- Step: summary ---
  useEffect(() => {
    if (step !== 'summary') return;

    // Save config
    const tz = timezone || detectTimezone();
    buildConfig({
      projectDir,
      cpu: parseInt(cpu, 10),
      memory: parseInt(memory, 10),
      disk: parseInt(disk, 10),
      timezone: tz,
    });

    const items: { label: string; value: string; ok: boolean }[] = [
      { label: 'Project directory', value: projectDir, ok: true },
    ];
    if (platform.needsVM) {
      items.push({ label: 'Colima VM', value: `${cpu} CPU, ${memory}GB RAM, ${disk}GB disk`, ok: colimaRunning });
    }
    items.push(
      { label: 'Docker', value: dockerVersion || 'connected', ok: dockerStatus === 'done' },
      { label: 'Images built', value: `${Array.from(selectedImages).length} images`, ok: buildsDone },
      { label: 'Timezone', value: tz, ok: true },
      { label: 'Scheduler daemon', value: platform.needsVM ? 'launchd agent' : 'systemd timer', ok: daemonStatus === 'done' },
    );
    setSummaryItems(items);
  }, [step, projectDir, cpu, memory, disk, timezone, colimaRunning, dockerVersion, dockerStatus, selectedImages, buildsDone, daemonStatus]);

  // --- Navigation helpers ---
  const advance = useCallback(() => {
    setError(null);

    // Build the step list dynamically based on platform
    const steps: Step[] = [
      'welcome', 'prerequisites', 'dependencies',
    ];
    if (platform.needsVM) {
      steps.push('colima-config', 'colima-start');
    }
    steps.push(
      'docker-verify', 'files-setup', 'image-select',
      'image-build', 'timezone', 'daemon', 'summary',
    );

    const idx = steps.indexOf(step);

    // Skip dependencies step if nothing to install
    if (step === 'prerequisites' && missingDeps.length === 0) {
      // Jump to the step after dependencies
      const depsIdx = steps.indexOf('dependencies');
      if (depsIdx < steps.length - 1) {
        setStep(steps[depsIdx + 1]);
      }
      return;
    }

    // Skip image-build if no images selected
    if (step === 'image-select' && selectedImages.size === 0) {
      setStep('timezone');
      return;
    }

    if (idx < steps.length - 1) {
      setStep(steps[idx + 1]);
    }
  }, [step, missingDeps, selectedImages]);

  const retry = useCallback(() => {
    setError(null);
    // Re-trigger the current step by toggling
    const current = step;
    setStep('welcome');
    setTimeout(() => setStep(current), 0);
  }, [step]);

  // --- Input handling ---
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

    // Error state: retry / skip / quit
    if (error && step !== 'prerequisites') {
      if (input === 'r') {
        retry();
        return;
      }
      if (input === 's' && step !== 'colima-config') {
        setError(null);
        advance();
        return;
      }
      if (input === 'q') {
        exit();
        return;
      }
      return;
    }

    // Step-specific input handling
    switch (step) {
      case 'welcome':
        if (key.return) advance();
        if (input === 'q') exit();
        break;

      case 'prerequisites':
        if (prereqsDone && !error) {
          if (key.return) advance();
        }
        if (prereqsDone && error) {
          if (input === 'q') exit();
        }
        break;

      case 'dependencies':
        if (depsDone) {
          if (key.return) advance();
        }
        break;

      case 'colima-config':
        if (key.tab || (key.return && configField !== 'disk')) {
          if (configField === 'cpu') setConfigField('memory');
          else if (configField === 'memory') setConfigField('disk');
        } else if (key.return && configField === 'disk') {
          const cpuValue = parsePositiveInt(cpu);
          const memoryValue = parsePositiveInt(memory);
          const diskValue = parsePositiveInt(disk);
          if (!cpuValue || !memoryValue || !diskValue) {
            setError('Colima CPU, memory, and disk must be positive whole numbers.');
            return;
          }
          advance();
        }
        break;

      case 'colima-start':
        if (colimaStatus === 'done') {
          if (key.return) advance();
        }
        break;

      case 'docker-verify':
        if (dockerStatus === 'done') {
          if (key.return) advance();
        }
        break;

      case 'files-setup':
        if (filesResult) {
          if (key.return) advance();
        }
        break;

      case 'image-select':
        if (availableImages.length === 0) {
          if (key.return) advance();
          break;
        }
        if (key.upArrow || input === 'k') {
          setImageCursor((c) => Math.max(0, c - 1));
        } else if (key.downArrow || input === 'j') {
          setImageCursor((c) => Math.min(availableImages.length - 1, c + 1));
        } else if (input === ' ') {
          setSelectedImages((prev) => {
            const next = new Set(prev);
            const img = availableImages[imageCursor];
            if (next.has(img)) next.delete(img);
            else next.add(img);
            return next;
          });
        } else if (key.return) {
          advance();
        }
        break;

      case 'image-build':
        if (buildsDone) {
          if (key.return) advance();
        }
        break;

      case 'timezone':
        if (!editTimezone) {
          if (input === 'e') {
            setEditTimezone(true);
          } else if (key.return) {
            advance();
          }
        } else if (editTimezone && key.return) {
          setEditTimezone(false);
        }
        break;

      case 'daemon':
        if (daemonStatus === 'done') {
          if (key.return) advance();
        }
        break;

      case 'summary':
        if (key.return || input === 'q') {
          exit();
        }
        break;
    }
  });

  return (
    <Box flexDirection="column">
      {step === 'welcome' && <WelcomeStep />}
      {step === 'prerequisites' && (
        <PrerequisitesStep prereqs={prereqs} done={prereqsDone} error={error} />
      )}
      {step === 'dependencies' && (
        <DependenciesStep
          deps={missingDeps}
          statuses={depStatuses}
          output={depOutput}
          done={depsDone}
        />
      )}
      {step === 'colima-config' && (
        <ColimaConfigStep
          cpu={cpu}
          memory={memory}
          disk={disk}
          onCpuChange={setCpu}
          onMemoryChange={setMemory}
          onDiskChange={setDisk}
          activeField={configField}
        />
      )}
      {step === 'colima-start' && (
        <ColimaStartStep status={colimaStatus} alreadyRunning={colimaRunning} error={error} />
      )}
      {step === 'docker-verify' && (
        <DockerVerifyStep status={dockerStatus} version={dockerVersion} error={error} />
      )}
      {step === 'files-setup' && (
        <FilesSetupStep result={filesResult} />
      )}
      {step === 'image-select' && (
        <ImageSelectStep
          images={availableImages}
          selected={selectedImages}
          cursor={imageCursor}
        />
      )}
      {step === 'image-build' && (
        <ImageBuildStep
          statuses={buildStatuses}
          output={buildOutput}
          done={buildsDone}
        />
      )}
      {step === 'timezone' && (
        <TimezoneStep
          timezone={timezone}
          editing={editTimezone}
          onTimezoneChange={setTimezone}
        />
      )}
      {step === 'daemon' && (
        <DaemonStep status={daemonStatus} error={error} />
      )}
      {step === 'summary' && <SummaryStep items={summaryItems} />}

      {/* Error bar with retry/skip/quit */}
      {error && step !== 'prerequisites' && step !== 'summary' && (
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
          <Text dimColor>
            {step === 'colima-config'
              ? '  [r] Retry  [q] Quit'
              : '  [r] Retry  [s] Skip  [q] Quit'}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function parsePositiveInt(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

// --- Step components ---

function WelcomeStep() {
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="magenta">Agent Oven</Text>
        <Text dimColor> - Setup Wizard</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>Welcome to Agent Oven setup. This wizard will:</Text>
        <Text dimColor>  1. Check and install prerequisites ({platform.prerequisites.join(', ')})</Text>
        {platform.needsVM && <Text dimColor>  2. Configure and start the Colima VM</Text>}
        <Text dimColor>  {platform.needsVM ? '3' : '2'}. Create directories and build Docker images</Text>
        <Text dimColor>  {platform.needsVM ? '4' : '3'}. Install the scheduler daemon</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>[enter] Start  [q] Quit</Text>
      </Box>
    </Box>
  );
}

function PrerequisitesStep({
  prereqs,
  done,
  error,
}: {
  prereqs: PrereqResult[];
  done: boolean;
  error: string | null;
}) {
  return (
    <Box flexDirection="column">
      <StepHeader title="Checking Prerequisites" step={1} />
      <Box flexDirection="column" marginTop={1}>
        {prereqs.map((p) => (
          <Box key={p.name}>
            <Text color={p.status.installed ? 'green' : 'red'}>
              {p.status.installed ? '●' : '○'}
            </Text>
            <Text> {p.name}</Text>
            {p.status.version && <Text dimColor> ({p.status.version})</Text>}
            {!p.status.installed && <Text color="red"> not found</Text>}
          </Box>
        ))}
        {!done && (
          <Box>
            <Text color="cyan"><Spinner type="dots" /></Text>
            <Text> Checking...</Text>
          </Box>
        )}
      </Box>
      {done && !error && (
        <Box marginTop={1}>
          <Text dimColor>[enter] Continue</Text>
        </Box>
      )}
      {done && error && (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
          <Text dimColor>  [q] Quit</Text>
        </Box>
      )}
    </Box>
  );
}

function DependenciesStep({
  deps,
  statuses,
  output,
  done,
}: {
  deps: string[];
  statuses: Record<string, StepStatus>;
  output: string;
  done: boolean;
}) {
  return (
    <Box flexDirection="column">
      <StepHeader title="Installing Dependencies" step={2} />
      <Box flexDirection="column" marginTop={1}>
        {deps.map((dep) => (
          <Box key={dep}>
            <StatusIcon status={statuses[dep] ?? 'pending'} />
            <Text> Installing {dep}...</Text>
          </Box>
        ))}
      </Box>
      {output && (
        <Box marginTop={1}>
          <Text dimColor>{output}</Text>
        </Box>
      )}
      {done && (
        <Box marginTop={1}>
          <Text dimColor>[enter] Continue</Text>
        </Box>
      )}
    </Box>
  );
}

function ColimaConfigStep({
  cpu,
  memory,
  disk,
  onCpuChange,
  onMemoryChange,
  onDiskChange,
  activeField,
}: {
  cpu: string;
  memory: string;
  disk: string;
  onCpuChange: (v: string) => void;
  onMemoryChange: (v: string) => void;
  onDiskChange: (v: string) => void;
  activeField: 'cpu' | 'memory' | 'disk';
}) {
  return (
    <Box flexDirection="column">
      <StepHeader title="Colima VM Configuration" step={3} />
      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Text color={activeField === 'cpu' ? 'cyan' : undefined}>{'CPU cores '.padEnd(12)}</Text>
          <TextInput
            value={cpu}
            onChange={onCpuChange}
            focus={activeField === 'cpu'}
            placeholder="2"
          />
        </Box>
        <Box>
          <Text color={activeField === 'memory' ? 'cyan' : undefined}>{'Memory GB '.padEnd(12)}</Text>
          <TextInput
            value={memory}
            onChange={onMemoryChange}
            focus={activeField === 'memory'}
            placeholder="4"
          />
        </Box>
        <Box>
          <Text color={activeField === 'disk' ? 'cyan' : undefined}>{'Disk GB   '.padEnd(12)}</Text>
          <TextInput
            value={disk}
            onChange={onDiskChange}
            focus={activeField === 'disk'}
            placeholder="20"
          />
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>[tab] Next field  [enter] Continue</Text>
      </Box>
    </Box>
  );
}

function ColimaStartStep({
  status,
  alreadyRunning,
  error,
}: {
  status: StepStatus;
  alreadyRunning: boolean;
  error: string | null;
}) {
  return (
    <Box flexDirection="column">
      <StepHeader title="Starting Colima" step={4} />
      <Box marginTop={1}>
        <StatusIcon status={status} />
        <Text>
          {status === 'running' ? ' Starting Colima VM...' : ''}
          {status === 'done' && alreadyRunning ? ' Colima is already running' : ''}
          {status === 'done' && !alreadyRunning ? ' Colima started successfully' : ''}
          {status === 'failed' ? ' Failed to start Colima' : ''}
        </Text>
      </Box>
      {status === 'done' && !error && (
        <Box marginTop={1}>
          <Text dimColor>[enter] Continue</Text>
        </Box>
      )}
    </Box>
  );
}

function DockerVerifyStep({
  status,
  version,
  error,
}: {
  status: StepStatus;
  version: string;
  error: string | null;
}) {
  return (
    <Box flexDirection="column">
      <StepHeader title="Verifying Docker" step={platform.needsVM ? 5 : 3} />
      <Box marginTop={1}>
        <StatusIcon status={status} />
        <Text>
          {status === 'running' ? ' Checking Docker connection...' : ''}
          {status === 'done' ? ` Docker ${version} is available` : ''}
          {status === 'failed' ? ' Docker is not responding' : ''}
        </Text>
      </Box>
      {status === 'done' && !error && (
        <Box marginTop={1}>
          <Text dimColor>[enter] Continue</Text>
        </Box>
      )}
    </Box>
  );
}

function FilesSetupStep({ result }: { result: { created: string[]; existed: string[] } | null }) {
  if (!result) {
    return (
      <Box flexDirection="column">
        <StepHeader title="Setting Up Files" step={platform.needsVM ? 6 : 4} />
        <Box marginTop={1}>
          <Text color="cyan"><Spinner type="dots" /></Text>
          <Text> Creating directories...</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <StepHeader title="Setting Up Files" step={platform.needsVM ? 6 : 4} />
      <Box flexDirection="column" marginTop={1}>
        {result.created.map((f) => (
          <Box key={f}>
            <Text color="green">+</Text>
            <Text> Created {f}</Text>
          </Box>
        ))}
        {result.existed.map((f) => (
          <Box key={f}>
            <Text dimColor>- Already exists {f}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>[enter] Continue</Text>
      </Box>
    </Box>
  );
}

function ImageSelectStep({
  images,
  selected,
  cursor,
}: {
  images: string[];
  selected: Set<string>;
  cursor: number;
}) {
  return (
    <Box flexDirection="column">
      <StepHeader title="Select Docker Images to Build" step={platform.needsVM ? 7 : 5} />
      {images.length === 0 ? (
        <Box marginTop={1}>
          <Text dimColor>No images found in images/ directory</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {images.map((img, i) => (
            <Box key={img}>
              <Text color={i === cursor ? 'cyan' : undefined}>
                {i === cursor ? '>' : ' '} [{selected.has(img) ? 'x' : ' '}] agent-oven/{img}
              </Text>
            </Box>
          ))}
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>[space] Toggle  [j/k] Navigate  [enter] Continue</Text>
      </Box>
    </Box>
  );
}

function ImageBuildStep({
  statuses,
  output,
  done,
}: {
  statuses: Record<string, StepStatus>;
  output: string;
  done: boolean;
}) {
  const entries = Object.entries(statuses);

  return (
    <Box flexDirection="column">
      <StepHeader title="Building Docker Images" step={platform.needsVM ? 8 : 6} />
      <Box flexDirection="column" marginTop={1}>
        {entries.map(([name, status]) => (
          <Box key={name}>
            <StatusIcon status={status} />
            <Text> agent-oven/{name}</Text>
          </Box>
        ))}
      </Box>
      {output && (
        <Box marginTop={1}>
          <Text dimColor>{output}</Text>
        </Box>
      )}
      {done && (
        <Box marginTop={1}>
          <Text dimColor>[enter] Continue</Text>
        </Box>
      )}
    </Box>
  );
}

function TimezoneStep({
  timezone,
  editing,
  onTimezoneChange,
}: {
  timezone: string;
  editing: boolean;
  onTimezoneChange: (v: string) => void;
}) {
  return (
    <Box flexDirection="column">
      <StepHeader title="Timezone" step={platform.needsVM ? 9 : 7} />
      <Box marginTop={1}>
        {editing ? (
          <Box>
            <Text>Timezone: </Text>
            <TextInput value={timezone} onChange={onTimezoneChange} focus={true} />
          </Box>
        ) : (
          <Box>
            <Text>Detected: </Text>
            <Text color="cyan">{timezone}</Text>
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{editing ? '[enter] Confirm' : '[e] Edit  [enter] Accept'}</Text>
      </Box>
    </Box>
  );
}

function DaemonStep({
  status,
  error,
}: {
  status: StepStatus;
  error: string | null;
}) {
  return (
    <Box flexDirection="column">
      <StepHeader title="Installing Scheduler Daemon" step={platform.needsVM ? 10 : 8} />
      <Box marginTop={1}>
        <StatusIcon status={status} />
        <Text>
          {status === 'running' ? ' Installing scheduler daemon...' : ''}
          {status === 'done' ? ' Scheduler daemon installed and loaded' : ''}
          {status === 'failed' ? ' Failed to install daemon' : ''}
        </Text>
      </Box>
      {status === 'done' && !error && (
        <Box marginTop={1}>
          <Text dimColor>[enter] Continue</Text>
        </Box>
      )}
    </Box>
  );
}

function SummaryStep({ items }: { items: { label: string; value: string; ok: boolean }[] }) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="magenta">Agent Oven</Text>
        <Text dimColor> - Setup Complete</Text>
      </Box>

      <Box flexDirection="column" marginTop={1} borderStyle="single" paddingX={1}>
        {items.map((item) => (
          <Box key={item.label}>
            <Text color={item.ok ? 'green' : 'red'}>{item.ok ? '●' : '○'}</Text>
            <Text> {item.label.padEnd(22)}</Text>
            <Text color="cyan">{item.value}</Text>
          </Box>
        ))}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Next steps:</Text>
        <Text dimColor>  Run </Text>
        <Text color="cyan">  agent-oven</Text>
        <Text dimColor>  to open the TUI and manage your jobs.</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>[enter] Exit</Text>
      </Box>
    </Box>
  );
}

// --- Shared sub-components ---

function StepHeader({ title, step }: { title: string; step: number }) {
  return (
    <Box>
      <Text bold color="magenta">{title}</Text>
      <Text dimColor> (step {step}/{platform.needsVM ? 10 : 8})</Text>
    </Box>
  );
}

function StatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case 'running':
      return <Text color="cyan"><Spinner type="dots" /></Text>;
    case 'done':
      return <Text color="green">●</Text>;
    case 'failed':
      return <Text color="red">●</Text>;
    case 'skipped':
      return <Text dimColor>○</Text>;
    default:
      return <Text dimColor>○</Text>;
  }
}
