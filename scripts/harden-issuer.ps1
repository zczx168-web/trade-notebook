$ErrorActionPreference = 'Stop'
$issuerDirectory = Join-Path $env:LOCALAPPDATA 'TradeNotebookIssuer'
if (-not (Test-Path -LiteralPath $issuerDirectory)) { New-Item -ItemType Directory -Path $issuerDirectory | Out-Null }
$directoryItem = Get-Item -LiteralPath $issuerDirectory
if ($directoryItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'The issuer data directory must not be a symbolic link or junction.' }
$ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$directoryAcl = Get-Acl -LiteralPath $issuerDirectory
$directoryAcl.SetSecurityDescriptorSddlForm(('D:P(A;OICI;FA;;;{0})(A;OICI;FA;;;{1})' -f $ownerSid.Value, $systemSid.Value), [Security.AccessControl.AccessControlSections]::Access)
$directoryItem.SetAccessControl($directoryAcl)
foreach ($fileName in @('issuer.private.pem', 'issuer-state.json', 'issuer-runtime.json')) {
    $filePath = Join-Path $issuerDirectory $fileName
    if (Test-Path -LiteralPath $filePath) {
        if ((Get-Item -LiteralPath $filePath).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'An issuer data file must not be a symbolic link.' }
        $fileAcl = Get-Acl -LiteralPath $filePath
        $fileAcl.SetSecurityDescriptorSddlForm(('D:P(A;;FA;;;{0})(A;;FA;;;{1})' -f $ownerSid.Value, $systemSid.Value), [Security.AccessControl.AccessControlSections]::Access)
        (Get-Item -LiteralPath $filePath).SetAccessControl($fileAcl)
    }
}
Write-Output 'Issuer data access restricted to the current Windows account and SYSTEM.'
