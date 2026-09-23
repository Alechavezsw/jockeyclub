Add-Type -AssemblyName System.Drawing

$src = "C:\Users\Usuario\.cursor\projects\c-Users-Usuario-Desktop-Proyectos-Jockey-Club\assets\c__Users_Usuario_AppData_Roaming_Cursor_User_workspaceStorage_b9901619cde6421e5e65683d5cf36e60_images_Logo__1_-e63c3ab3-0aff-4c92-abf9-b5cc740c3f12.png"
$dest = "C:\Users\Usuario\Desktop\Proyectos\Jockey Club\public\logo-jockey-club.png"

$srcImg = [System.Drawing.Bitmap]::FromFile($src)
$w = $srcImg.Width
$h = $srcImg.Height
$bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($srcImg, 0, 0, $w, $h)
$g.Dispose()
$srcImg.Dispose()

function IsInk([System.Drawing.Color]$c) {
  return ($c.R -lt 40 -and $c.G -lt 40 -and $c.B -lt 40)
}

$n = $w * $h
$ink = New-Object bool[] $n
for ($y = 0; $y -lt $h; $y++) {
  for ($x = 0; $x -lt $w; $x++) {
    $ink[$y * $w + $x] = IsInk $bmp.GetPixel($x, $y)
  }
}

$visited = New-Object bool[] $n
$queue = New-Object System.Collections.Generic.Queue[int]
function Enqueue([int]$i) {
  if ($i -lt 0 -or $i -ge $n) { return }
  if (-not $ink[$i] -or $visited[$i]) { return }
  $visited[$i] = $true
  $queue.Enqueue($i)
}

for ($x = 0; $x -lt $w; $x++) {
  Enqueue $x
  Enqueue (($h - 1) * $w + $x)
}
for ($y = 0; $y -lt $h; $y++) {
  Enqueue ($y * $w)
  Enqueue ($y * $w + ($w - 1))
}

while ($queue.Count -gt 0) {
  $i = $queue.Dequeue()
  $x = $i % $w
  $y = [int]($i / $w)
  if ($x -gt 0) { Enqueue ($i - 1) }
  if ($x -lt $w - 1) { Enqueue ($i + 1) }
  if ($y -gt 0) { Enqueue ($i - $w) }
  if ($y -lt $h - 1) { Enqueue ($i + $w) }
}

# Remaining ink: text, nails, and the sealed interior disk.
$labels = New-Object int[] $n
$compSizes = New-Object 'System.Collections.Generic.List[int]'
$compSizes.Add(0) | Out-Null
$label = 0
for ($i = 0; $i -lt $n; $i++) {
  if (-not $ink[$i] -or $visited[$i] -or $labels[$i] -ne 0) { continue }
  $label++
  $size = 0
  $q2 = New-Object System.Collections.Generic.Queue[int]
  $labels[$i] = $label
  $q2.Enqueue($i)
  while ($q2.Count -gt 0) {
    $j = $q2.Dequeue()
    $size++
    $x = $j % $w
    $y = [int]($j / $w)
    $neigh = @()
    if ($x -gt 0) { $neigh += ($j - 1) }
    if ($x -lt $w - 1) { $neigh += ($j + 1) }
    if ($y -gt 0) { $neigh += ($j - $w) }
    if ($y -lt $h - 1) { $neigh += ($j + $w) }
    foreach ($k in $neigh) {
      if ($ink[$k] -and -not $visited[$k] -and $labels[$k] -eq 0) {
        $labels[$k] = $label
        $q2.Enqueue($k)
      }
    }
  }
  $compSizes.Add($size) | Out-Null
}

# Drop the large interior black field; keep lettering and nail dots.
$drop = New-Object bool[] ($label + 1)
for ($c = 1; $c -le $label; $c++) {
  if ($compSizes[$c] -gt 2500) { $drop[$c] = $true }
}

$transparent = [System.Drawing.Color]::FromArgb(0, 0, 0, 0)
for ($i = 0; $i -lt $n; $i++) {
  if ($visited[$i] -or ($labels[$i] -gt 0 -and $drop[$labels[$i]])) {
    $x = $i % $w
    $y = [int]($i / $w)
    $bmp.SetPixel($x, $y, $transparent)
  }
}

if (Test-Path $dest) { Remove-Item $dest -Force }
$bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "components=$label saved $dest"
