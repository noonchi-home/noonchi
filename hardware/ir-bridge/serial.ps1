param([Parameter(Mandatory=$true)][ValidatePattern('^COM[1-9][0-9]*$')][string]$PortName)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.IO.Ports;
using System.Threading;

public static class NoonchiIrSerial {
    public const int Busy = 3;
    public static int Run(string name) {
        using (var port = new SerialPort(name, 115200, Parity.None, 8, StopBits.One))
        using (var stopped = new ManualResetEvent(false)) {
            port.NewLine = "\n";
            port.ReadTimeout = 250;
            port.WriteTimeout = 500;
            port.DtrEnable = true;
            // Another program holds the port. The exception text follows the Windows display language, so the hub reads exit code 3 instead.
            try { port.Open(); }
            catch (UnauthorizedAccessException e) { Console.Error.WriteLine(e.Message); return Busy; }
            var writer = new Thread(() => {
                try {
                    string line;
                    while ((line = Console.ReadLine()) != null) port.WriteLine(line);
                } catch (Exception e) {
                    Console.Error.WriteLine(e.Message);
                } finally { stopped.Set(); }
            });
            writer.IsBackground = true;
            writer.Start();
            while (!stopped.WaitOne(0)) {
                try { Console.WriteLine(port.ReadLine().TrimEnd('\r')); }
                catch (TimeoutException) { }
            }
        }
        return 0;
    }
}
"@
exit [NoonchiIrSerial]::Run($PortName)
