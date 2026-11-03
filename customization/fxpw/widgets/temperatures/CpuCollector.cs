// Compiled with the Windows .NET Framework compiler; no SDK installation required.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using LibreHardwareMonitor.Hardware;

internal static class CpuCollector
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

    private static int Main(string[] args)
    {
        string output = args.Length > 0 ? Path.GetFullPath(args[0]) : null;
        if (output == null) return 1;
        string directory = Path.GetDirectoryName(output);
        Directory.CreateDirectory(directory);
        bool ownsMutex;
        using (var mutex = new Mutex(true, "Local\\fxpw.Seelen.CpuSensors." + WindowsIdentity.GetCurrent().User.Value, out ownsMutex))
        {
            if (!ownsMutex) return 10;
            var computer = new Computer { IsCpuEnabled = true };
            try
            {
                computer.Open();
                do
                {
                    var readings = new List<Reading>();
                    foreach (var hardware in computer.Hardware)
                    {
                        if (hardware.HardwareType == HardwareType.Cpu) Read(hardware, readings);
                    }
                    // Prefer package / die temperature, not a CCD, core or motherboard socket.
                    var selected = readings.OrderBy(r => Priority(r.name)).ThenByDescending(r => r.temperature).FirstOrDefault();
                    var snapshot = new
                    {
                        sampledAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                        temperature = selected == null ? (double?)null : selected.temperature,
                        source = selected == null ? null : selected.source,
                        name = selected == null ? null : selected.name,
                        provider = "LibreHardwareMonitor 0.9.6",
                        pid = Process.GetCurrentProcess().Id,
                        sensors = readings,
                        error = selected == null ? "No CPU temperature. Check PawnIO and collector administrator rights." : null
                    };
                    WriteAtomic(output, Json.Serialize(snapshot));
                    if (args.Length > 1 && args[1] == "--once") return selected == null ? 2 : 0;
                    Thread.Sleep(2000);
                } while (true);
            }
            catch (Exception error)
            {
                File.WriteAllText(Path.Combine(directory, "collector-error.log"), error.ToString());
                return 1;
            }
            finally
            {
                computer.Close();
                mutex.ReleaseMutex();
            }
        }
    }

    private static void Read(IHardware hardware, List<Reading> readings)
    {
        hardware.Update();
        foreach (var sensor in hardware.Sensors)
        {
            if (sensor.SensorType != SensorType.Temperature || !sensor.Value.HasValue) continue;
            float value = sensor.Value.Value;
            // AMD SMN reads return zero when driver access is unavailable.
            // Never present that initialization value as a measured CPU temperature.
            if (value <= 0 || float.IsNaN(value) || float.IsInfinity(value)) continue;
            readings.Add(new Reading { temperature = value, source = sensor.Identifier.ToString(), name = sensor.Name });
        }
        foreach (var child in hardware.SubHardware) Read(child, readings);
    }

    private static int Priority(string name)
    {
        string lower = name.ToLowerInvariant();
        if (lower.Contains("tctl/tdie")) return 0;
        if (lower.Contains("tdie")) return 1;
        if (lower.Contains("package")) return 2;
        if (lower.Contains("tctl")) return 3;
        return 4;
    }

    private static void WriteAtomic(string path, string content)
    {
        string temporary = path + ".tmp";
        File.WriteAllText(temporary, content, new UTF8Encoding(false));
        if (File.Exists(path)) File.Replace(temporary, path, null);
        else File.Move(temporary, path);
    }

    private sealed class Reading
    {
        public double temperature { get; set; }
        public string source { get; set; }
        public string name { get; set; }
    }
}
