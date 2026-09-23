$src = "C:\Users\Usuario\Desktop\Proyectos\Jockey Club\public\logo-jockey-club.png"

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

public static class LogoInkInspect {
  public static string Run(string src) {
    using (var bmp = new Bitmap(src)) {
      int w = bmp.Width, h = bmp.Height, n = w * h;
      var rect = new Rectangle(0, 0, w, h);
      var data = bmp.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
      var bytes = new byte[Math.Abs(data.Stride) * h];
      Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);
      int stride = data.Stride;
      bmp.UnlockBits(data);

      var ink = new bool[n];
      for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
          int p = y * stride + x * 4;
          byte a = bytes[p + 3], b = bytes[p], g = bytes[p + 1], r = bytes[p + 2];
          ink[y * w + x] = a > 200 && r < 45 && g < 45 && b < 45;
        }
      }

      var labels = new int[n];
      var sizes = new List<int> { 0 };
      var minx = new List<int> { 0 };
      var maxx = new List<int> { 0 };
      var miny = new List<int> { 0 };
      var maxy = new List<int> { 0 };
      int lab = 0;
      for (int i = 0; i < n; i++) {
        if (!ink[i] || labels[i] != 0) continue;
        lab++;
        int size = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
        var q = new Queue<int>();
        labels[i] = lab;
        q.Enqueue(i);
        while (q.Count > 0) {
          int j = q.Dequeue();
          size++;
          int x = j % w, y = j / w;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
          int[] neigh = { x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1 };
          foreach (int k in neigh) {
            if (k >= 0 && ink[k] && labels[k] == 0) {
              labels[k] = lab;
              q.Enqueue(k);
            }
          }
        }
        sizes.Add(size);
        minx.Add(x0); maxx.Add(x1); miny.Add(y0); maxy.Add(y1);
      }

      var sb = new StringBuilder();
      sb.Append("blackComponents=").Append(lab);
      for (int c = 1; c <= lab; c++) {
        sb.Append(" [").Append(c).Append(" n=").Append(sizes[c])
          .Append(" x=").Append(minx[c]).Append("-").Append(maxx[c])
          .Append(" y=").Append(miny[c]).Append("-").Append(maxy[c])
          .Append("]");
      }
      return sb.ToString();
    }
  }
}
"@

[LogoInkInspect]::Run($src)
