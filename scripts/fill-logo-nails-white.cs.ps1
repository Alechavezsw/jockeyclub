$src = "C:\Users\Usuario\Desktop\Proyectos\Jockey Club\public\logo-jockey-club.png"
$dest = "C:\Users\Usuario\Desktop\Proyectos\Jockey Club\public\logo-jockey-club.nails.png"

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class LogoNailFill {
  public static string Run(string src, string dest) {
    using (var srcImg = new Bitmap(src)) {
      int w = srcImg.Width, h = srcImg.Height, n = w * h;
      var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
      using (var g = Graphics.FromImage(bmp)) g.DrawImage(srcImg, 0, 0, w, h);

      var rect = new Rectangle(0, 0, w, h);
      var data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
      var bytes = new byte[Math.Abs(data.Stride) * h];
      Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);
      int stride = data.Stride;
      Func<int, int, int> idx = (x, y) => y * stride + x * 4;

      var ink = new bool[n];
      for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
          int p = idx(x, y);
          ink[y * w + x] = bytes[p + 3] > 200 && bytes[p + 2] < 45 && bytes[p + 1] < 45 && bytes[p] < 45;
        }
      }

      var lab = new int[n];
      var sizes = new List<int> { 0 };
      var minX = new List<int> { 0 };
      var maxX = new List<int> { 0 };
      var minY = new List<int> { 0 };
      var maxY = new List<int> { 0 };
      int cCount = 0;
      for (int i = 0; i < n; i++) {
        if (!ink[i] || lab[i] != 0) continue;
        cCount++;
        int size = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
        var q = new Queue<int>();
        lab[i] = cCount;
        q.Enqueue(i);
        while (q.Count > 0) {
          int j = q.Dequeue();
          size++;
          int x = j % w, y = j / w;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
          int[] neigh = { x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1 };
          foreach (int k in neigh) {
            if (k >= 0 && ink[k] && lab[k] == 0) { lab[k] = cCount; q.Enqueue(k); }
          }
        }
        sizes.Add(size);
        minX.Add(x0); maxX.Add(x1); minY.Add(y0); maxY.Add(y1);
      }

      var fill = new bool[cCount + 1];
      int nails = 0;
      for (int c = 1; c <= cCount; c++) {
        int bw = maxX[c] - minX[c] + 1;
        int bh = maxY[c] - minY[c] + 1;
        int cx = (minX[c] + maxX[c]) / 2;
        int cy = (minY[c] + maxY[c]) / 2;
        bool inHeart = cx >= 380 && cx <= 640 && cy >= 680 && cy <= 900;
        if (inHeart) continue;
        bool compact = bw >= 12 && bh >= 12 && bw <= 50 && bh <= 50;
        bool roundish = Math.Abs(bw - bh) <= 12;
        bool nailSize = sizes[c] >= 80 && sizes[c] <= 1600;
        if (compact && roundish && nailSize) { fill[c] = true; nails++; }
      }

      for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
          int c = lab[y * w + x];
          if (c > 0 && fill[c]) {
            int p = idx(x, y);
            bytes[p] = 255;
            bytes[p + 1] = 255;
            bytes[p + 2] = 255;
            bytes[p + 3] = 255;
          }
        }
      }

      Marshal.Copy(bytes, 0, data.Scan0, bytes.Length);
      bmp.UnlockBits(data);
      bmp.Save(dest, ImageFormat.Png);
      bmp.Dispose();
      return "nails=" + nails + " blackComponents=" + cCount;
    }
  }
}
"@

$out = [LogoNailFill]::Run($src, $dest)
Write-Output $out
Write-Output "saved $dest"
