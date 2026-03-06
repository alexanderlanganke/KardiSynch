import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { FolderOpen, ArrowRight, ArrowLeft, Check } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

interface OnboardingWizardProps {
  onComplete: () => void;
}

const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ onComplete }) => {
  const [step, setStep] = useState(0);
  const [dataPath, setDataPath] = useState('');
  const [importDir, setImportDir] = useState('');
  const [enableAutomation, setEnableAutomation] = useState(true);
  const [saving, setSaving] = useState(false);

  const handleBrowse = async (setter: (val: string) => void) => {
    try {
      const dir = await window.electronAPI.selectDirectory();
      if (dir) setter(dir);
    } catch (e) {
      console.error('Failed to select directory:', e);
    }
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      const settings: any = {};
      if (dataPath) settings.dataPath = dataPath;
      if (importDir) settings.importDir = importDir;
      if (enableAutomation) {
        settings.mriManufacturers = {
          'Biotronik': true,
          'Medtronic': true,
          'Abbott': true,
          'Boston Scientific': true,
        };
      }
      await window.electronAPI.setSettings(settings);
      onComplete();
    } catch (e) {
      console.error('Failed to save settings:', e);
      alert('Failed to save settings. You can configure them later in Settings.');
      onComplete();
    } finally {
      setSaving(false);
    }
  };

  const steps = [
    // Step 1: Data Directory
    {
      title: 'Welcome to KardiSynch',
      description: 'Choose where to store patient data. This is where all imported reports and patient records will be kept.',
      content: (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="data-path">Data Directory</Label>
            <div className="flex gap-2">
              <Input
                id="data-path"
                value={dataPath}
                onChange={(e) => setDataPath(e.target.value)}
                placeholder="Select a directory for patient data..."
              />
              <Button variant="outline" size="icon" onClick={() => handleBrowse(setDataPath)} aria-label="Browse for data directory">
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              This folder will contain all patient records, visits, and imported files.
            </p>
          </div>
        </div>
      ),
    },
    // Step 2: Import Folder
    {
      title: 'Import Folder',
      description: 'Set up the folder where you will drop new reports for automatic import.',
      content: (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="import-dir">Import Directory</Label>
            <div className="flex gap-2">
              <Input
                id="import-dir"
                value={importDir}
                onChange={(e) => setImportDir(e.target.value)}
                placeholder="Select an import directory..."
              />
              <Button variant="outline" size="icon" onClick={() => handleBrowse(setImportDir)} aria-label="Browse for import directory">
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Drop PDF, XML, or proprietary files here. KardiSynch will automatically parse and sort them.
            </p>
          </div>
        </div>
      ),
    },
    // Step 3: Automation
    {
      title: 'Automation',
      description: 'Enable automatic MRI compatibility and manufacturer safety checks.',
      content: (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="space-y-1">
              <Label>Enable Safety Checks</Label>
              <p className="text-xs text-muted-foreground">
                Automatically check MRI compatibility and manufacturer warnings for imported devices.
              </p>
            </div>
            <Switch checked={enableAutomation} onCheckedChange={setEnableAutomation} />
          </div>
          {enableAutomation && (
            <p className="text-xs text-muted-foreground">
              Checks will run in the background for Biotronik, Medtronic, Abbott, and Boston Scientific devices.
              You can configure individual manufacturers later in Settings.
            </p>
          )}
        </div>
      ),
    },
  ];

  const currentStep = steps[step];
  const isLastStep = step === steps.length - 1;

  return (
    <div className="flex items-center justify-center h-screen bg-background">
      <Card className="w-full max-w-lg mx-4">
        <CardHeader>
          <div className="flex items-center gap-2 mb-2">
            {steps.map((_, idx) => (
              <div
                key={idx}
                className={`h-1.5 flex-1 rounded-full transition-colors ${idx <= step ? 'bg-primary' : 'bg-muted'}`}
              />
            ))}
          </div>
          <CardTitle>{currentStep.title}</CardTitle>
          <CardDescription>{currentStep.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {currentStep.content}

          <div className="flex justify-between pt-4">
            <Button
              variant="ghost"
              onClick={() => setStep(s => s - 1)}
              disabled={step === 0}
            >
              <ArrowLeft className="h-4 w-4 mr-2" /> Back
            </Button>
            {isLastStep ? (
              <Button onClick={handleFinish} disabled={saving}>
                <Check className="h-4 w-4 mr-2" /> {saving ? 'Saving...' : 'Get Started'}
              </Button>
            ) : (
              <Button onClick={() => setStep(s => s + 1)}>
                Next <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            )}
          </div>

          {!isLastStep && (
            <button
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={onComplete}
            >
              Skip setup
            </button>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default OnboardingWizard;
