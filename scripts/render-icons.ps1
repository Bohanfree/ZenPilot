$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$iconPath = Join-Path $PSScriptRoot '..\extension\icons'
foreach ($size in @(16, 32, 48, 128)) {
  $scale = $size / 96.0
  $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.ScaleTransform($scale, $scale)

  $tile = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $tile.AddArc(0, 0, 48, 48, 180, 90)
  $tile.AddArc(48, 0, 48, 48, 270, 90)
  $tile.AddArc(48, 48, 48, 48, 0, 90)
  $tile.AddArc(0, 48, 48, 48, 90, 90)
  $tile.CloseFigure()
  $tileBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.RectangleF]::new(0, 0, 96, 96),
    [System.Drawing.Color]::FromArgb(48, 52, 95),
    [System.Drawing.Color]::FromArgb(7, 23, 45),
    45.0
  )
  $graphics.FillPath($tileBrush, $tile)

  $letterBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.RectangleF]::new(24, 23, 50, 50),
    [System.Drawing.Color]::White,
    [System.Drawing.Color]::FromArgb(116, 120, 255),
    60.0
  )
  $pen = [System.Drawing.Pen]::new($letterBrush, 9)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $graphics.DrawLines($pen, [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(28, 29),
    [System.Drawing.PointF]::new(67, 29),
    [System.Drawing.PointF]::new(29, 67),
    [System.Drawing.PointF]::new(68, 67)
  ))
  $star = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new(76, 15),
    [System.Drawing.PointF]::new(78.2, 21.8),
    [System.Drawing.PointF]::new(85, 24),
    [System.Drawing.PointF]::new(78.2, 26.2),
    [System.Drawing.PointF]::new(76, 33),
    [System.Drawing.PointF]::new(73.8, 26.2),
    [System.Drawing.PointF]::new(67, 24),
    [System.Drawing.PointF]::new(73.8, 21.8)
  )
  $graphics.FillPolygon([System.Drawing.Brushes]::White, $star)
  $file = Join-Path $iconPath "icon-$size.png"
  $bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $pen.Dispose()
  $letterBrush.Dispose()
  $tileBrush.Dispose()
  $tile.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}
