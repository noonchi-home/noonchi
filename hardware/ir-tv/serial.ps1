param([Parameter(Mandatory=$true)][ValidatePattern('^COM[1-9][0-9]*$')][string]$PortName)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.IO.Ports;
using System.Threading;

public static class NoonchiIrSerial {
    public static void Run(string name) {
        using (var port = new SerialPort(name, 115200, Parity.None, 8, StopBits.One))
        using (var stopped = new ManualResetEvent(false)) {
            port.NewLine = "\n";
            port.ReadTimeout = 250;
            port.WriteTimeout = 500;
            port.DtrEnable = true;
            port.Open();
            port.WriteLine("hello");
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
    }
}
"@
[NoonchiIrSerial]::Run($PortName)
