#region --- Banner ---
function Show-Banner {
    param([string]$AppName)

    # 1. Define content lines
    $line1_text = ":: $AppName ::"
    $line2_text = "Initializing Interface"
    $line3_text = "~<*>~"
    $line4_text = "Status: Polling"
    $content = @($line1_text, $line2_text, $line3_text, $line4_text)

    # 2. Calculate dynamic width
    $maxWidth = ($content | ForEach-Object { $_.Length } | Measure-Object -Maximum).Maximum
    
    $widthMultiplier = 1.5
    $baseInnerWidth = $maxWidth + 4 
    $innerWidth = [Math]::Round($baseInnerWidth * $widthMultiplier)
    
    $totalWidth = $innerWidth + 2

    # 3. Height Calculation
    $CharacterPixelAspect = 2.0 
    $totalHeight = [Math]::Round(($totalWidth * 9 / 16) / $CharacterPixelAspect)
    
    # 4. Padding Calculation
    $paddingLinesNeeded = $totalHeight - 7 
    if ($paddingLinesNeeded -lt 0) { $paddingLinesNeeded = 0 }
    
    $paddingTop = [Math]::Floor($paddingLinesNeeded / 2)
    $paddingBottom = $paddingLinesNeeded - $paddingTop

    # 5. Create border
    $border = '+' + ('-' * $innerWidth) + '+'

    # 6. Re-usable centering function
    function Get-CenteredString {
        param([string]$text, [int]$width)
        $padTotal = $width - $text.Length
        if ($padTotal -lt 0) { $padTotal = 0 }
        $padLeft = [Math]::Floor($padTotal / 2)
        $padRight = $padTotal - $padLeft
        return (' ' * $padLeft) + $text + (' ' * $padRight)
    }

    # 7. Build the banner string
    $emptyLine = '|' + (' ' * $innerWidth) + '|'
    $bannerBuilder = [System.Text.StringBuilder]::new()
    $bannerBuilder.AppendLine($border) | Out-Null
    
    for ($i = 0; $i -lt $paddingTop; $i++) {
        $bannerBuilder.AppendLine($emptyLine) | Out-Null
    }
    $bannerBuilder.AppendLine("|$(Get-CenteredString $line1_text $innerWidth)|") | Out-Null
    $bannerBuilder.AppendLine($emptyLine) | Out-Null
    $bannerBuilder.AppendLine("|$(Get-CenteredString $line2_text $innerWidth)|") | Out-Null
    $bannerBuilder.AppendLine("|$(Get-CenteredString $line3_text $innerWidth)|") | Out-Null
    $bannerBuilder.AppendLine("|$(Get-CenteredString $line4_text $innerWidth)|") | Out-Null
    for ($i = 0; $i -lt $paddingBottom; $i++) {
        $bannerBuilder.AppendLine($emptyLine) | Out-Null
    }
    $bannerBuilder.Append($border) | Out-Null
    
    # 8. Display the banner
    Write-Host $bannerBuilder.ToString()
}
#endregion

#region --- Menu (SIMPLIFIED) ---
function Show-Menu {
    Write-Host ""
    Write-Host " [1] Force Manual Check / Move"
    Write-Host " [Q] Quit"
    Write-Host ""
}
#endregion

#region --- Configuration & State ---

# UNC paths to your Citrix-mapped client drives
$SourceDirectories = @("\\Client\A$", "\\Client\D$", "\\Client\B$", "\\Client\E$")

# The root destination for the files
$TargetDirectory = "\\mtkvmkommfs01.kliniken-mtk.de\MedtronicSmartSync\Sprechstunde"

# Set to $true to ONLY move .log and .pdf files.
$FilterEnabled = $false

# --- Thread-safe queue for log messages ---
$Global:LogQueue = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()
$Global:LogHistory = [System.Collections.Generic.List[string]]::new()
$MaxLogLines = 15 # Number of log lines to show on screen

# --- State for flicker-free display ---
$Global:LogRegionStartY = 0 
$Global:LastLogLineCount = 0 

# --- AppName logic ---
$BannerAppNameOverride = "" # Set this to override
if (-not [string]::IsNullOrEmpty($BannerAppNameOverride)) {
    $Global:AppName = $BannerAppNameOverride
}
elseif ($PSCommandPath) {
    # This gets the .ps1 filename
    $Global:AppName = Split-Path -Path $PSCommandPath -Leaf
}
else {
    # Fallback for interactive/untitled sessions
    $Global:AppName = "PSScript (Interactive)"
}
#endregion

#region --- Core File Functions ---

function Move-File {
    param ([string]$FullFilePath, [string]$SourceBasePath)
    if (-not (Test-Path -Path $FullFilePath -PathType Leaf)) { return }
    $RelativePath = $FullFilePath.Substring($SourceBasePath.Length).TrimStart("\")
    if ([string]::IsNullOrEmpty($RelativePath)) { return }
    if ($FilterEnabled -and $FullFilePath -notmatch "\.(log|pdf)$") {
        $Global:LogQueue.Enqueue("SKIP (Filter): $RelativePath")
        return
    }
    $TargetFile = Join-Path -Path $TargetDirectory -ChildPath $RelativePath
    $TargetFileDir = Split-Path -Path $TargetFile -Parent
    try {
        if (-not (Test-Path $TargetFileDir)) {
            New-Item -Path $TargetFileDir -ItemType Directory -Force -ErrorAction Stop | Out-Null
        }
        Move-Item -Path $FullFilePath -Destination $TargetFile -Force -ErrorAction Stop
        $Global:LogQueue.Enqueue("MOVED: $RelativePath")
    }
    catch {
        $Global:LogQueue.Enqueue("WARN: FAILED to move $RelativePath. Error: $($_.Exception.Message)")
    }
}

# *** FUNCTION MODIFIED FOR RELIABILITY ***
function Process-Backlog {
    param ([string]$DirectoryPath)
    
    $files = $null # Clear files variable
    try {
        # Try to get the file list. -ErrorAction Stop forces failures into the catch block.
        $files = Get-ChildItem -Path $DirectoryPath -Recurse -File -ErrorAction Stop
    }
    catch {
        # This will now catch "Path not found" errors and log them
        $Global:LogQueue.Enqueue("WARN: Failed to scan $DirectoryPath. Error: $($_.Exception.Message)")
        return # Exit the function
    }

    # If we got here, $files is either $null (empty) or a list
    if ($null -ne $files) {
        foreach ($file in $files) {
            Move-File -FullFilePath $file.FullName -SourceBasePath $DirectoryPath
        }
    }
}
#endregion

#region --- Polling Function ---
function Check-All-Drives {
    foreach ($dir in $SourceDirectories) {
        if (Test-Path $dir) {
            # If the drive exists, scan it for files
            Process-Backlog -DirectoryPath $dir
        }
        # No 'else' here, to avoid spamming the log
    }
}
#endregion

#region --- Screen Drawing Functions ---
# (These functions are unchanged)
function Draw-StaticUI {
    # This is called ONCE.
    Clear-Host
    Show-Banner -AppName $Global:AppName
    Show-Menu
    Write-Host "--- EVENT LOG (Last $MaxLogLines lines) ---"
    $Global:LogRegionStartY = [System.Console]::CursorTop
}

function Update-Log {
    # (This function is unchanged)
    $message = $null
    while ($Global:LogQueue.TryDequeue([ref]$message)) {
        $Global:LogHistory.Add($message)
    }
    while ($Global:LogHistory.Count -gt $MaxLogLines) {
        $Global:LogHistory.RemoveAt(0)
    }
}

function Update-LogDisplay {
    # (This function is unchanged)
    [System.Console]::SetCursorPosition(0, $Global:LogRegionStartY)
    $logSnapshot = @($Global:LogHistory)
    
    foreach ($line in $logSnapshot) {
        $linePadded = $line.PadRight($Host.UI.RawUI.WindowSize.Width) 
        if ($line.StartsWith("WARN:")) {
            Write-Host $linePadded -ForegroundColor Yellow -NoNewline
        }
        elseif ($line.StartsWith("MOVED:")) {
            Write-Host $linePadded -ForegroundColor Green -NoNewline
        }
        else {
            Write-Host $linePadded -NoNewline
        }
    }
    $linesToClear = $Global:LastLogLineCount - $logSnapshot.Count
    if ($linesToClear -gt 0) {
        $blankLine = " ".PadRight($Host.UI.RawUI.WindowSize.Width)
        for ($i = 0; $i -lt $linesToClear; $i++) {
            Write-Host $blankLine -NoNewline
        }
    }
    $Global:LastLogLineCount = $logSnapshot.Count
}

#endregion

#region --- Main Loop ---
try {
    [System.Console]::CursorVisible = $false
    
    # 3-second polling interval
    $checkInterval = [timespan]::FromSeconds(3) 
    $lastCheck = [datetime]::Now
    $Global:LogQueue.Enqueue("INFO: Script started. Polling for drives...")

    # --- Initial Draw ---
    Check-All-Drives
    Update-Log
    Draw-StaticUI
    Update-LogDisplay

    # --- Main Loop ---
    while ($true) {
        $actionTaken = $false
        
        # 1. Check for key press
        if ($Host.UI.RawUI.KeyAvailable) {
            $key = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
            $actionTaken = $true
            
            switch ($key.Character) {
                '1' {
                    $Global:LogQueue.Enqueue("[ACTION] Forcing manual drive check...")
                    Check-All-Drives
                }
                'q' {
                    $Global:LogQueue.Enqueue("[ACTION] Quitting...")
                    break # This exits the while loop
                }
            }
        }
        
        # 2. Check drive status if timer has elapsed
        if (([datetime]::Now - $lastCheck) -ge $checkInterval) {
            $actionTaken = $true
            Check-All-Drives
            $lastCheck = [datetime]::Now
        }

        # 3. REDRAW LOG ONLY if an action happened
        if ($actionTaken) {
            Update-Log
            Update-LogDisplay
        }

        # 4. Sleep to prevent 100% CPU usage.
        Start-Sleep -Milliseconds 100
    }
}
finally {
    # This block runs when the loop breaks (on 'q')
    
    Update-Log
    Update-LogDisplay
    
    [System.Console]::SetCursorPosition(0, $Global:LogRegionStartY + $Global:LastLogLineCount + 2)
    [System.Console]::CursorVisible = $true
    Write-Host "Script terminated."
}

#endregion