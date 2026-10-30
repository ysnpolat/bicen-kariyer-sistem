namespace BicenKariyer.Panel;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new AnaForm());
    }
}
