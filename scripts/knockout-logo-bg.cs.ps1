$src = "C:\Users\Usuario\.cursor\projects\c-Users-Usuario-Desktop-Proyectos-Jockey-Club\assets\c__Users_Usuario_AppData_Roaming_Cursor_User_workspaceStorage_b9901619cde6421e5e65683d5cf36e60_images_Logo__1_-e63c3ab3-0aff-4c92-abf9-b5cc740c3f12.png"
$dest = "C:\Users\Usuario\Desktop\Proyectos\Jockey Club\public\logo-jockey-club.png"

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class LogoKnockout {
  public static void Run(string src, string dest) {
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
          ink[y * w + x] = bytes[p + 2] < 40 && bytes[p + 1] < 40 && bytes[p] < 40;
        }
      }

      var visited = new bool[n];
      var q = new Queue<int>();
      Action<int> enq = i => {
        if (i < 0 || i >= n || !ink[i] || visited[i]) return;
        visited[i] = true;
        q.Enqueue(i);
      };
      for (int x = 0; x < w; x++) { enq(x); enq((h - 1) * w + x); }
      for (int y = 0; y < h; y++) { enq(y * w); enq(y * w + w - 1); }
      while (q.Count > 0) {
        int i = q.Dequeue();
        int x = i % w, y = i / w;
        if (x > 0) enq(i - 1);
        if (x < w - 1) enq(i + 1);
        if (y > 0) enq(i - w);
        if (y < h - 1) enq(i + w);
      }

      var labels = new int[n];
      var sizes = new List<int> { 0 };
      int lab = 0;
      for (int i = 0; i < n; i++) {
        if (!ink[i] || visited[i] || labels[i] != 0) continue;
        lab++;
        int size = 0;
        var q2 = new Queue<int>();
        labels[i] = lab;
        q2.Enqueue(i);
        while (q2.Count > 0) {
          int j = q2.Dequeue();
          size++;
          int x = j % w, y = j / w;
          int[] neigh = { x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1 };
          foreach (int k in neigh) {
            if (k >= 0 && ink[k] && !visited[k] && labels[k] == 0) {
              labels[k] = lab;
              q2.Enqueue(k);
            }
          }
        }
        sizes.Add(size);
      }

      var drop = new bool[lab + 1];
      for (int c = 1; c <= lab; c++) if (sizes[c] > 2500) drop[c] = true;

      for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
          int i = y * w + x;
          if (visited[i] || (labels[i] > 0 && drop[labels[i]])) {
            int p = idx(x, y);
            bytes[p] = 0; bytes[p + 1] = 0; bytes[p + 2] = 0; bytes[p + 3] = 0;
          }
        }
      }

      Marshal.Copy(bytes, 0, data.Scan0, bytes.Length);
      bmp.UnlockBits(data);
      bmp.Save(dest, ImageFormat.Png);
      bmp.Dispose();
      Console.WriteLine("components=" + lab);
    }
  }
}
"@

[LogoKnockout]::Run($src, $dest)
Write-Output "saved $dest"
