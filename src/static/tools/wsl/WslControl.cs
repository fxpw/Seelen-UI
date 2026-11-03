using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

internal static class WslControl
{
    private static string[] Plan(string action)
    {
        switch (action)
        {
            case "start": return new[] { "start" };
            case "restart": return new[] { "shutdown", "start" };
            case "stop": return new[] { "shutdown" };
            default: throw new ArgumentException("Unknown WSL action");
        }
    }

    private static int Main(string[] args)
    {
        try
        {
            bool dryRun = args.Length == 3 && args[0] == "--dry-run";
            if (!dryRun && args.Length != 1) return 2;
            string[] operations = Plan(dryRun ? args[1] : args[0]);
            if (dryRun)
            {
                File.WriteAllText(args[2], new JavaScriptSerializer().Serialize(operations));
                return 0;
            }
            string wsl = Path.Combine(Environment.SystemDirectory, "wsl.exe");
            foreach (string operation in operations)
            {
                if (operation == "start")
                {
                    // Open the user's default distribution in its normal terminal.
                    Process.Start(new ProcessStartInfo(wsl) { UseShellExecute = true });
                    continue;
                }
                var output = new StringBuilder();
                var info = new ProcessStartInfo(wsl, "--shutdown")
                {
                    UseShellExecute = false, CreateNoWindow = true,
                    RedirectStandardOutput = true, RedirectStandardError = true
                };
                using (var process = new Process { StartInfo = info })
                {
                    process.OutputDataReceived += (sender, message) => { lock (output) { output.AppendLine(message.Data); } };
                    process.ErrorDataReceived += (sender, message) => { lock (output) { output.AppendLine(message.Data); } };
                    process.Start();
                    process.BeginOutputReadLine();
                    process.BeginErrorReadLine();
                    if (!process.WaitForExit(30000))
                    {
                        process.Kill();
                        throw new TimeoutException("WSL shutdown did not finish within 30 seconds.");
                    }
                    process.WaitForExit();
                    if (process.ExitCode != 0) throw new IOException(output.ToString());
                }
            }
            return 0;
        }
        catch (Exception error)
        {
            string state = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "fxpw-seelen");
            Directory.CreateDirectory(state);
            File.AppendAllText(Path.Combine(state, "wsl.log"), DateTime.UtcNow.ToString("o") + " " + error + Environment.NewLine);
            return 1;
        }
    }
}
