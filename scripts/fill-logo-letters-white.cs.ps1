$src = "C:\Users\Usuario\Desktop\Proyectos\Jockey Club\public\logo-jockey-club.png"
$dest = "C:\Users\Usuario\Desktop\Proyectos\Jockey Club\public\logo-jockey-club.letters.png"

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

public static class LogoLetterFill2 {
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

      // 1) Huecos transparentes de las letras (no el campo central ni el borde)
      var hole = new bool[n];
      for (int y = 0; y < h; y++)
        for (int x = 0; x < w; x++)
          hole[y * w + x] = bytes[idx(x, y) + 3] < 16;

      var hLab = new int[n];
      var hSize = new List<int> { 0 };
      var hEdge = new List<bool> { false };
      int hc = 0;
      for (int i = 0; i < n; i++) {
        if (!hole[i] || hLab[i] != 0) continue;
        hc++;
        int size = 0;
        bool edge = false;
        var q = new Queue<int>();
        hLab[i] = hc;
        q.Enqueue(i);
        while (q.Count > 0) {
          int j = q.Dequeue();
          size++;
          int x = j % w, y = j / w;
          if (x == 0 || y == 0 || x == w - 1 || y == h - 1) edge = true;
          int[] neigh = { x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1 };
          foreach (int k in neigh) {
            if (k >= 0 && hole[k] && hLab[k] == 0) { hLab[k] = hc; q.Enqueue(k); }
          }
        }
        hSize.Add(size);
        hEdge.Add(edge);
      }
      int interior = 0, interiorSize = 0;
      for (int c = 1; c <= hc; c++) {
        if (hEdge[c]) continue;
        if (hSize[c] > interiorSize) { interiorSize = hSize[c]; interior = c; }
      }
      var fillHole = new bool[hc + 1];
      int holes = 0;
      for (int c = 1; c <= hc; c++) {
        if (hEdge[c] || c == interior) continue;
        if (hSize[c] >= 80 && hSize[c] <= 80000) { fillHole[c] = true; holes++; }
      }

      // 2) Tinta negra que quedó adentro de las letras / AMO MI CLUB → blanco
      var ink = new bool[n];
      for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
          int p = idx(x, y);
          ink[y * w + x] = bytes[p + 3] > 200 && bytes[p + 2] < 45 && bytes[p + 1] < 45 && bytes[p] < 45;
        }
      }
      var iLab = new int[n];
      var iSize = new List<int> { 0 };
      var iMinX = new List<int> { 0 };
      var iMaxX = new List<int> { 0 };
      var iMinY = new List<int> { 0 };
      var iMaxY = new List<int> { 0 };
      int ic = 0;
      for (int i = 0; i < n; i++) {
        if (!ink[i] || iLab[i] != 0) continue;
        ic++;
        int size = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
        var q = new Queue<int>();
        iLab[i] = ic;
        q.Enqueue(i);
        while (q.Count > 0) {
          int j = q.Dequeue();
          size++;
          int x = j % w, y = j / w;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
          int[] neigh = { x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1 };
          foreach (int k in neigh) {
            if (k >= 0 && ink[k] && iLab[k] == 0) { iLab[k] = ic; q.Enqueue(k); }
          }
        }
        iSize.Add(size);
        iMinX.Add(x0); iMaxX.Add(x1); iMinY.Add(y0); iMaxY.Add(y1);
      }

      var fillInk = new bool[ic + 1];
      int inks = 0;
      for (int c = 1; c <= ic; c++) {
        int cx = (iMinX[c] + iMaxX[c]) / 2;
        int cy = (iMinY[c] + iMaxY[c]) / 2;
        bool horseshoeLetter = iSize[c] >= 1800 && iSize[c] <= 3000;
        bool heartLetter = cx >= 380 && cx <= 640 && cy >= 680 && cy <= 900 && iSize[c] >= 200 && iSize[c] <= 1500;
        if (horseshoeLetter || heartLetter) { fillInk[c] = true; inks++; }
      }

      for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
          int i = y * w + x;
          bool paint = (hLab[i] > 0 && fillHole[hLab[i]]) || (iLab[i] > 0 && fillInk[iLab[i]]);
          if (!paint) continue;
          int p = idx(x, y);
          bytes[p] = 255;
          bytes[p + 1] = 255;
          bytes[p + 2] = 255;
          bytes[p + 3] = 255;
        }
      }

      Marshal.Copy(bytes, 0, data.Scan0, bytes.Length);
      bmp.UnlockBits(data);
      bmp.Save(dest, ImageFormat.Png);
      bmp.Dispose();
      return "holes=" + holes + " inkLetters=" + inks + " interior=" + interiorSize;
    }
  }
}
"@

$out = [LogoLetterFill2]::Run($src, $dest)
Write-Output $out
Write-Output "saved $dest"
