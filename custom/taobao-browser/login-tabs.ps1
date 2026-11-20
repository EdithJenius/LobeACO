param([int]$BrowserPid, [switch]$Cleanup)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationTypes,UIAutomationClient
$element = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]
$type = [System.Windows.Automation.ControlType]
$pidFilter = [System.Windows.Automation.PropertyCondition]::new($element::ProcessIdProperty, $BrowserPid)
$tabFilter = [System.Windows.Automation.PropertyCondition]::new($element::ControlTypeProperty, $type::TabItem)
$buttonFilter = [System.Windows.Automation.PropertyCondition]::new($element::ControlTypeProperty, $type::Button)
$windows = $element::RootElement.FindAll($scope::Children,$pidFilter)
$tabs = @(foreach ($window in $windows) { $window.FindAll($scope::Descendants,$tabFilter) })
# All labels are ASCII here so Windows PowerShell also reads this script as ANSI.
$newTab = -join ([char[]](0x65B0,0x6807,0x7B7E,0x9875))
$close = -join ([char[]](0x5173,0x95ED))
$blank = @($tabs | Where-Object { $_.Current.Name -in @('about:blank','New Tab',$newTab) })
if ($Cleanup) {
    if ($blank.Count -eq 1 -and $tabs.Count -gt 1) {
        $button = $blank[0].FindAll($scope::Descendants,$buttonFilter) | Where-Object { $_.Current.Name -in @('Close','Close tab',$close) } | Select-Object -First 1
        if ($button) { $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
    }
} elseif ($blank.Count -eq 1 -and $tabs.Count -eq 1) { 'empty' }
