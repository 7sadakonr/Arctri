// Starts `node fake-agent.mjs <args>` in the same console, like a native agent executable would run.
using System;
using System.Diagnostics;
using System.IO;

class FakeLauncher
{
    static int Main(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string script = Path.Combine(dir, "fake-agent.mjs");
        var psi = new ProcessStartInfo("node", "\"" + script + "\" " + string.Join(" ", args));
        psi.UseShellExecute = false;
        using (var p = Process.Start(psi))
        {
            p.WaitForExit();
            return p.ExitCode;
        }
    }
}
