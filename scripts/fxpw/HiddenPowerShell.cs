using System;
using System.Diagnostics;
using System.IO;

internal static class HiddenPowerShell
{
    private static int Main(string[] args)
    {
        if (args.Length != 1 || !File.Exists(args[0]))
            return 2;

        try
        {
            string script = Path.GetFullPath(args[0]);
            var start = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
                    @"WindowsPowerShell\v1.0\powershell.exe"),
                Arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File \"" + script + "\"",
                WorkingDirectory = Path.GetDirectoryName(script),
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            using (Process child = Process.Start(start))
            {
                child.WaitForExit();
                return child.ExitCode;
            }
        }
        catch (Exception error)
        {
            Trace.TraceError(error.ToString());
            return 1;
        }
    }
}
