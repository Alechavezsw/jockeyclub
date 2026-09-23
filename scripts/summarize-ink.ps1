$t = Get-Content -Raw "C:\Users\Usuario\.cursor\projects\c-Users-Usuario-Desktop-Proyectos-Jockey-Club\agent-tools\b8d89985-ebab-4a1a-baa1-d9f2309d6601.txt"
if ($t -match 'blackComponents=(\d+)') { Write-Output "count=$($Matches[1])" }
$rx = [regex]'\[(\d+) n=(\d+) x=(\d+)-(\d+) y=(\d+)-(\d+)\]'
$rows = foreach ($m in $rx.Matches($t)) {
  $n = [int]$m.Groups[2].Value
  if ($n -lt 80) { continue }
  [pscustomobject]@{
    id = [int]$m.Groups[1].Value
    n  = $n
    x1 = [int]$m.Groups[3].Value
    x2 = [int]$m.Groups[4].Value
    y1 = [int]$m.Groups[5].Value
    y2 = [int]$m.Groups[6].Value
    w  = [int]$m.Groups[4].Value - [int]$m.Groups[3].Value + 1
    h  = [int]$m.Groups[6].Value - [int]$m.Groups[5].Value + 1
  }
}
$rows | Sort-Object n -Descending | Format-Table -AutoSize | Out-String -Width 200
